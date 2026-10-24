const fs = require("fs");
const path = require("path");
const { getHistoricalCandles } = require("./binance");

const UNIT_MS = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };

function intervalMs(interval) {
    const match = /^(\d+)([mhdw])$/.exec(interval);
    if (!match) throw new Error(`Unsupported interval: ${interval}`);
    return Number(match[1]) * UNIT_MS[match[2]];
}

// Same cache file naming as backtester.js, so candles you already downloaded are reused.
async function loadCandles(symbol, interval, total, { refresh = false } = {}) {
    const cache = path.join("data", `${symbol}_${interval}_${total}.json`);
    if (!refresh && fs.existsSync(cache)) {
        return JSON.parse(fs.readFileSync(cache, "utf8"));
    }
    const candles = await getHistoricalCandles(symbol, interval, total);
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(candles));
    return candles;
}

module.exports = { loadCandles, intervalMs };
