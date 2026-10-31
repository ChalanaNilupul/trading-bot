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

test("runner restores a pending futures entry and executes it once after restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-pending-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stateFile = path.join(dir, "state.json");
  const tradeLog = path.join(dir, "trades.jsonl");

  const T = 1_700_000_000_000;

  const candle = (openTime, open, high, low, close) => ({
    openTime,
    closeTime: openTime + 60_000,
    open,
    high,
    low,
    close,
    volume: 100,
  });

  const neutral = {
    signal: "HOLD",
    indicators: { atr14: 1 },
  };

  const engine = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    slippage: 0,
    maxPositionPercent: 0.25,
  });

  // Generate an entry signal. The engine queues it for the next candle.
  engine.onCandle(candle(T, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });

  assert.deepEqual(engine.pending, {
    type: "OPEN_LONG",
    atr: 1,
  });

  assert.equal(engine.position, null);

  const original = new Runner("SOLUSDT", {
    stateFile,
    tradeLog,
    engine,
  });

  original.lastProcessed = T + 60_000;
  original.persist();

  // Simulate a restart using a new runner and engine.
  const restarted = new Runner("SOLUSDT", {
    stateFile,
    tradeLog,
  });

  await restarted.init(false);

  assert.deepEqual(
    restarted.engine.pending,
    original.engine.pending,
    "pending order must survive restart",
  );

  assert.equal(restarted.engine.position, null);

  // The restored order should execute at the next candle's open.
  restarted.engine.onCandle(
    candle(T + 120_000, 101, 101.5, 100.5, 101),
    neutral,
  );

  assert.ok(
    restarted.engine.position,
    "restored pending order must open a position",
  );

  assert.equal(restarted.engine.position.side, "LONG");
  assert.equal(
    restarted.engine.position.entryPrice,
    101 * (1 + restarted.engine.cfg.slippage),
  );
  assert.equal(restarted.engine.pending, null);

  const openedQuantity = restarted.engine.position.quantity;

  // A further candle must not execute the same order a second time.
  restarted.engine.onCandle(
    candle(T + 180_000, 101, 101.5, 100.5, 101),
    neutral,
  );

  assert.equal(restarted.engine.position.quantity, openedQuantity);
  assert.equal(restarted.engine.pending, null);
  assert.equal(restarted.engine.trades.length, 0);
});
