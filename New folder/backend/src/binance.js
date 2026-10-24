const BASE_URL = "https://api.binance.com";
const FUTURES_URL = "https://fapi.binance.com";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseCandles(data) {
    return data.map(c => ({
        openTime: c[0],
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5]),
        closeTime: c[6],
    }));
}

/** GET with timeout, retry + exponential backoff, and Binance rate-limit (429/418) handling. */
async function request(url, { retries = 3, timeoutMs = 10000 } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (response.ok) return await response.json();

            const body = await response.text().catch(() => "");
            const error = new Error(`Binance API error ${response.status}: ${body}`);

            const rateLimited = response.status === 429 || response.status === 418;
            if (rateLimited) {
                const retryAfter = Number(response.headers.get("retry-after"));
                error.retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
            } else if (response.status >= 400 && response.status < 500) {
                error.fatal = true; // bad symbol / bad params: retrying won't help
                throw error;
            }
            lastError = error;
        } catch (error) {
            if (error.fatal) throw error;
            lastError = error;
        } finally {
            clearTimeout(timer);
        }

        if (attempt < retries) await sleep(lastError.retryAfterMs ?? 500 * 2 ** attempt);
    }

    throw lastError;
}

/** Most recent CLOSED candles (the still-forming candle is dropped). */
async function getCandles(symbol = "BTCUSDT", interval = "15m", limit = 500) {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const url = `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit + 1}`;
    const data = await request(url);
    const now = Date.now();
    return parseCandles(data).filter(c => c.closeTime <= now).slice(-safeLimit);
}

async function getHistoricalCandles(symbol = "BTCUSDT", interval = "15m", totalCandles = 5000) {
    const all = [];
    let endTime = Date.now();

    while (all.length < totalCandles) {
        const batchSize = Math.min(1000, totalCandles - all.length);
        const url = `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${batchSize}&endTime=${endTime}`;

        console.log(`Downloading ${symbol} ${interval}... ${all.length}/${totalCandles}`);
        const data = await request(url);
        if (data.length === 0) break;

        const candles = parseCandles(data);
        all.unshift(...candles);
        endTime = candles[0].openTime - 1;

        if (data.length < batchSize) break;
        await sleep(150);
    }

    const now = Date.now();
    const unique = Array.from(new Map(all.map(c => [c.openTime, c])).values());
    return unique
        .filter(c => c.closeTime <= now)
        .sort((a, b) => a.openTime - b.openTime)
        .slice(-totalCandles);
}

/** 24h tickers for every symbol (one call). */
async function getTickers24h() {
    return request(`${BASE_URL}/api/v3/ticker/24hr`, { timeoutMs: 20000 });
}

const STABLE_BASES = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDD", "AEUR", "EUR", "USDE", "PYUSD", "XUSD", "USD1"]);

/** Most liquid USDT pairs by 24h quote volume, stablecoins excluded. */
async function getTopUSDTSymbols({ limit = 30, minQuoteVolume = 20_000_000 } = {}) {
    const tickers = await getTickers24h();
    return tickers
        .filter(t => t.symbol.endsWith("USDT"))
        .filter(t => !STABLE_BASES.has(t.symbol.slice(0, -4)))
        .map(t => ({ symbol: t.symbol, quoteVolume: Number(t.quoteVolume) }))
        .filter(t => t.quoteVolume >= minQuoteVolume)
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, limit)
        .map(t => t.symbol);
}

/** Exchange trading rules: lot step and min order value (needed to size real orders correctly). */
async function getSymbolFilters(symbol) {
    const info = await request(`${BASE_URL}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
    const s = info.symbols?.[0];
    if (!s) throw new Error(`Symbol not found: ${symbol}`);

    const lot = s.filters.find(f => f.filterType === "LOT_SIZE");
    const notional = s.filters.find(f => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL");
    const price = s.filters.find(f => f.filterType === "PRICE_FILTER");

    return {
        stepSize: lot ? Number(lot.stepSize) : null,
        minQty: lot ? Number(lot.minQty) : 0,
        minNotional: notional ? Number(notional.minNotional) : 0,
        tickSize: price ? Number(price.tickSize) : null,
    };
}


/** USDⓈ-M Futures public market data. These endpoints never place orders. */
async function getFuturesCandles(symbol = "BTCUSDT", interval = "15m", limit = 500) {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const url = `${FUTURES_URL}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit + 1}`;
    const data = await request(url);
    const now = Date.now();
    return parseCandles(data).filter(c => c.closeTime <= now).slice(-safeLimit);
}

/** Download up to 20,000 most recent CLOSED USDⓈ-M Futures candles using pagination. */
async function getFuturesHistoricalCandles(symbol = "BTCUSDT", interval = "4h", totalCandles = 5000) {
    const requested = Math.max(1, Math.min(20000, Math.floor(Number(totalCandles) || 5000)));
    const all = [];
    let endTime = Date.now();
    while (all.length < requested) {
        const batchSize = Math.min(1000, requested - all.length);
        const url = `${FUTURES_URL}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${batchSize}&endTime=${endTime}`;
        const data = await request(url, { timeoutMs: 20000 });
        if (!Array.isArray(data) || data.length === 0) break;
        const batch = parseCandles(data);
        all.unshift(...batch);
        endTime = batch[0].openTime - 1;
        if (data.length < batchSize) break;
        await sleep(150);
    }
    const now = Date.now();
    return Array.from(new Map(all.filter(c => c.closeTime <= now).map(c => [c.openTime, c])).values())
        .sort((a, b) => a.openTime - b.openTime)
        .slice(-requested);
}

async function getFuturesTickers24h() {
    return request(`${FUTURES_URL}/fapi/v1/ticker/24hr`, { timeoutMs: 20000 });
}

async function getFuturesSymbolFilters(symbol) {
    const info = await request(`${FUTURES_URL}/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
    const s = info.symbols?.[0];
    if (!s) throw new Error(`Futures symbol not found: ${symbol}`);
    const lot = s.filters.find(f => f.filterType === "LOT_SIZE");
    const marketLot = s.filters.find(f => f.filterType === "MARKET_LOT_SIZE") || lot;
    const notional = s.filters.find(f => f.filterType === "MIN_NOTIONAL" || f.filterType === "NOTIONAL");
    const price = s.filters.find(f => f.filterType === "PRICE_FILTER");
    return {
        stepSize: marketLot ? Number(marketLot.stepSize) : (lot ? Number(lot.stepSize) : null),
        minQty: marketLot ? Number(marketLot.minQty) : (lot ? Number(lot.minQty) : 0),
        minNotional: notional ? Number(notional.notional ?? notional.minNotional ?? 0) : 5,
        tickSize: price ? Number(price.tickSize) : null,
    };
}

module.exports = { getCandles, getHistoricalCandles, getTickers24h, getTopUSDTSymbols, getSymbolFilters, getFuturesCandles, getFuturesHistoricalCandles, getFuturesTickers24h, getFuturesSymbolFilters };
