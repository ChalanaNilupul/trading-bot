const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Runner } = require("../src/index");

function makeCandles(count = 600) {
  return Array.from({ length: count }, (_, i) => {
    const close = 200 + i * 0.1;
    return {
      openTime: i * 900000,
      closeTime: (i + 1) * 900000 - 1,
      open: close - 0.05,
      high: close + 0.08,
      low: close - 0.08,
      close,
      volume: 1000,
    };
  });
}

test("first candle processing saves the latest closed candle without replaying history", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-runner-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = new Runner("SOLUSDT");
  runner.stateFile = path.join(dir, "state.json");

  const candles = makeCandles();
  const latestClosed = candles[candles.length - 1];

  const changed = runner.processCandles(
    candles,
    candles[candles.length - 1].close,
    Date.now(),
  );

  assert.equal(changed, true);
  assert.equal(runner.lastProcessed, latestClosed.closeTime);
  assert.equal(runner.engine.position, null);
  assert.equal(runner.engine.trades.length, 0);

  const saved = JSON.parse(fs.readFileSync(runner.stateFile, "utf8"));
  assert.equal(saved.lastProcessed, latestClosed.closeTime);
});
