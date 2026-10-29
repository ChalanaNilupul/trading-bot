const test = require("node:test");
const assert = require("node:assert/strict");
const { PortfolioRiskManager } = require("../src/portfolioRiskManager");

const DAY = Date.UTC(2026, 0, 1, 12, 0, 0);
const position = (symbol, side, quantity, entryPrice, stopPrice) => ({
  symbol, side, quantity, entryPrice, stopPrice,
});

test("allows a candidate when portfolio limits are respected", () => {
  const risk = new PortfolioRiskManager({
    maxOpenPositions: 2,
    maxSameDirectionPositions: 2,
    maxAggregateStopRiskPct: 0.01,
  });
  const result = risk.canOpen({
    equity: 1000,
    timestamp: DAY,
    positions: [],
    candidate: { symbol: "BTCUSDT", side: "LONG", estimatedStopRisk: 2 },
  });
  assert.equal(result.allowed, true);
});

test("blocks entries when the portfolio daily loss limit is reached", () => {
  const risk = new PortfolioRiskManager({ maxDailyLossPct: 0.01 });
  risk.canOpen({
    equity: 1000, timestamp: DAY, positions: [],
    candidate: { symbol: "BTCUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  const result = risk.canOpen({
    equity: 989, timestamp: DAY + 60_000, positions: [],
    candidate: { symbol: "ETHUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /daily loss limit/i);
});

test("blocks a candidate when maximum drawdown is reached", () => {
  const risk = new PortfolioRiskManager({ maxDrawdownPct: 0.05, maxDailyLossPct: 0.20 });
  risk.canOpen({
    equity: 1000, timestamp: DAY, positions: [],
    candidate: { symbol: "BTCUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  const result = risk.canOpen({
    equity: 949, timestamp: DAY + 60_000, positions: [],
    candidate: { symbol: "ETHUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /drawdown/i);
});

test("blocks a second position when the max-open-position limit is one", () => {
  const risk = new PortfolioRiskManager({ maxOpenPositions: 1 });
  const result = risk.canOpen({
    equity: 1000, timestamp: DAY,
    positions: [position("BTCUSDT", "LONG", 0.01, 50000, 49000)],
    candidate: { symbol: "ETHUSDT", side: "SHORT", estimatedStopRisk: 2 },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /max open positions/i);
});

test("blocks duplicate positions on the same symbol", () => {
  const risk = new PortfolioRiskManager({ maxOpenPositions: 5, maxSameDirectionPositions: 5 });
  const result = risk.canOpen({
    equity: 1000, timestamp: DAY,
    positions: [position("BTCUSDT", "LONG", 0.01, 50000, 49000)],
    candidate: { symbol: "BTCUSDT", side: "SHORT", estimatedStopRisk: 2 },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /already has an open position/i);
});

test("blocks entries when aggregate stop risk would exceed the limit", () => {
  const risk = new PortfolioRiskManager({
    maxOpenPositions: 3,
    maxSameDirectionPositions: 3,
    maxAggregateStopRiskPct: 0.01,
  });
  const result = risk.canOpen({
    equity: 1000, timestamp: DAY,
    positions: [position("BTCUSDT", "LONG", 0.01, 50000, 49500)], // $5 stop risk
    candidate: { symbol: "ETHUSDT", side: "SHORT", estimatedStopRisk: 6 },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /aggregate stop risk/i);
});

test("requires explicit manual reset after a halt", () => {
  const risk = new PortfolioRiskManager({ maxDailyLossPct: 0.01 });
  risk.canOpen({
    equity: 1000, timestamp: DAY, positions: [],
    candidate: { symbol: "BTCUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  risk.canOpen({
    equity: 989, timestamp: DAY + 60_000, positions: [],
    candidate: { symbol: "ETHUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  const blocked = risk.canOpen({
    equity: 1000, timestamp: DAY + 120_000, positions: [],
    candidate: { symbol: "ETHUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  assert.equal(blocked.allowed, false);
  risk.reset({ equity: 1000, timestamp: DAY + 180_000 });
  const allowed = risk.canOpen({
    equity: 1000, timestamp: DAY + 240_000, positions: [],
    candidate: { symbol: "ETHUSDT", side: "LONG", estimatedStopRisk: 1 },
  });
  assert.equal(allowed.allowed, true);
});
