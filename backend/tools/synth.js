/**
 * Synthetic OHLCV generator (regime-switching random walk) for offline testing.
 * Useful for checking plumbing and accounting; results on it say NOTHING about real profitability.
 *   node tools/synth.js out.json [count] [seed] [intervalMs]
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generateCandles(count = 8000, seed = 42, stepMs = 15 * 60 * 1000, startPrice = 2000) {
    const rand = mulberry32(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

    const candles = [];
    let price = startPrice;
    let drift = 0;
    let vol = 0.002;
    const t0 = Date.UTC(2024, 0, 1);

    for (let i = 0; i < count; i++) {
        if (i % 400 === 0) { // new regime every ~4 days of 15m candles
            const r = rand();
            drift = r < 0.35 ? 0.0004 : r < 0.6 ? -0.0004 : 0;
            vol = 0.001 + rand() * 0.003;
        }
        const open = price;
        const close = open * Math.exp(drift + vol * gauss());
        const high = Math.max(open, close) * (1 + Math.abs(gauss()) * vol * 0.5);
        const low = Math.min(open, close) * (1 - Math.abs(gauss()) * vol * 0.5);
        candles.push({
            openTime: t0 + i * stepMs,
            open, high, low, close,
            volume: 100 + rand() * 900,
            closeTime: t0 + (i + 1) * stepMs - 1,
        });
        price = close;
    }
    return candles;
}

module.exports = { generateCandles };

if (require.main === module) {
    const [out = "data/synthetic.json", count = "8000", seed = "42", step = String(15 * 60 * 1000)] = process.argv.slice(2);
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(generateCandles(Number(count), Number(seed), Number(step))));
    console.log(`Wrote ${count} synthetic candles to ${out}`);
}
