const BASE_URL = "https://api.binance.com";

function parseCandles(data) {
    return data.map(candle => ({
        openTime: candle[0],
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
        closeTime: candle[6],
    }));
}

async function request(url) {
    const response = await fetch(url);
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Binance API error ${response.status}: ${body}`);
    }
    return response.json();
}

async function getCandles(symbol = "BTCUSDT", interval = "1m", limit = 500) {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const url = `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit + 1}`;
    const data = await request(url);
    const now = Date.now();

    return parseCandles(data)
        .filter(candle => candle.closeTime <= now)
        .slice(-safeLimit);
}

async function getHistoricalCandles(symbol = "BTCUSDT", interval = "1m", totalCandles = 5000) {
    const allCandles = [];
    let endTime = Date.now();

    while (allCandles.length < totalCandles) {
        const remaining = totalCandles - allCandles.length;
        const batchSize = Math.min(1000, remaining);

        let url = `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${batchSize}&endTime=${endTime}`;

        console.log(`Downloading ${symbol} candles... ${allCandles.length}/${totalCandles}`);

        const data = await request(url);
        if (data.length === 0) break;

        const candles = parseCandles(data);
        allCandles.unshift(...candles);
        endTime = candles[0].openTime - 1;

        if (data.length < batchSize) break;

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const unique = Array.from(new Map(allCandles.map(c => [c.openTime, c])).values());

    return unique.sort((a, b) => a.openTime - b.openTime).slice(-totalCandles);
}

async function getExchangeInfo() {
    return request(`${BASE_URL}/api/v3/exchangeInfo`);
}

async function getUSDTSymbols() {
    const info = await getExchangeInfo();

    return info.symbols
        .filter(s => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed)
        .map(s => s.symbol);
}

module.exports = {
    getCandles,
    getHistoricalCandles,
    getExchangeInfo,
    getUSDTSymbols,
};
