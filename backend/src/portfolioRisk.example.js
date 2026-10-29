/**
 * EXAMPLE INTEGRATION ADAPTER — review and adapt before enabling.
 *
 * This file intentionally does not import or mutate Runner/FuturesEngine.
 * It shows how to build a consistent snapshot from the existing runners.
 */
const { PortfolioRiskManager } = require("./portfolioRiskManager");

const portfolioRisk = new PortfolioRiskManager({
  maxDailyLossPct: 0.01,
  maxDrawdownPct: 0.05,
  maxOpenPositions: 1,
  maxSameDirectionPositions: 1,
  maxAggregateStopRiskPct: 0.01,
});

/**
 * Use one shared starting balance for the entire portfolio.
 * Do not sum per-symbol starting balances if each runner has already been
 * initialized with START_BALANCE / SYMBOLS.length.
 */
function getPortfolioSnapshot(runners) {
  const positions = [];
  let equity = 0;

  for (const runner of runners) {
    const engine = runner.engine;
    const price = Number(runner.lastPrice || engine.position?.entryPrice || 0);
    if (!(price > 0)) {
      // Caller should treat this as unavailable data and block new entries.
      return { valid: false, reason: `No valid current price for ${runner.symbol}` };
    }

    equity += engine.equity(price);

    if (engine.position) {
      positions.push({
        symbol: runner.symbol,
        side: engine.position.side,
        quantity: engine.position.quantity,
        entryPrice: engine.position.entryPrice,
        stopPrice: engine.position.stopPrice,
      });
    }
  }

  return { valid: Number.isFinite(equity) && equity > 0, equity, positions };
}

module.exports = { portfolioRisk, getPortfolioSnapshot };
