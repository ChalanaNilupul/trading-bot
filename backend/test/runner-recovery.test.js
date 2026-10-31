const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Runner } = require("../src/index");
const { FuturesEngine } = require("../src/futuresEngine");

test("runner restores an open futures position and candle checkpoint from disk", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stateFile = path.join(dir, "state.json");
  const tradeLog = path.join(dir, "trades.jsonl");

  const engine = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
  });

  // Use the same proven entry setup as the existing futures engine test.
  const T = 1_700_000_000_000;

  const candle = (openTime, open, high, low, close) => ({
    openTime,
    closeTime: openTime + 59_999,
    open,
    high,
    low,
    close,
    volume: 1000,
  });

  const neutral = {
    signal: "HOLD",
    indicators: { atr14: 1 },
  };

  engine.onCandle(candle(T, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });

  engine.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);

  assert.ok(engine.position, "setup must create an open position");

  const original = new Runner("SOLUSDT", {
    stateFile,
    tradeLog,
    engine,
  });

  original.lastProcessed = T + 119_999;
  original.persist();

  // Create a completely new runner and engine, simulating process restart.
  const restarted = new Runner("SOLUSDT", {
    stateFile,
    tradeLog,
  });

  await restarted.init(false);

  assert.ok(restarted.engine.position, "position must restore from disk");

  for (const field of [
    "side",
    "entryPrice",
    "quantity",
    "margin",
    "stopPrice",
    "targetPrice",
    "liquidationPrice",
    "fundingPaid",
  ]) {
    assert.equal(
      restarted.engine.position[field],
      original.engine.position[field],
      `${field} must survive restart`,
    );
  }

  assert.equal(restarted.engine.cash, original.engine.cash);
  assert.equal(restarted.engine.trades.length, original.engine.trades.length);
  assert.equal(restarted.lastProcessed, original.lastProcessed);
  assert.equal(restarted.engine.equity, original.engine.equity);
});
