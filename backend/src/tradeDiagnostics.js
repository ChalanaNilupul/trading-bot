// Retrospective research only. Never consumed by strategy or execution decisions.
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

function buildTradeDiagnostics(trades, candles, { recoveryBars = 4 } = {}) {
  if (!Number.isInteger(recoveryBars) || recoveryBars < 1 || recoveryBars > 100)
    throw new Error('recoveryBars must be an integer from 1 to 100');
  const rows = trades.map((trade, index) => {
    const { entryTime, exitTime, entryPrice, exitPrice, quantity } = trade;
    if (![entryTime, exitTime, entryPrice, exitPrice, quantity, trade.netPnL, trade.grossPnL, trade.fees].every(Number.isFinite) || exitTime < entryTime || entryPrice <= 0 || exitPrice <= 0 || quantity <= 0)
      throw new Error(`Invalid diagnostic trade at index ${index}`);
    const side = trade.side === 'SHORT' ? -1 : 1;
    // Exit-bar wicks are excluded: OHLC does not establish whether a wick preceded an intrabar stop.
    // Also exclude partial entry bars. Executed entry/exit prices remain known observations.
    const held = candles.filter(c => c.openTime >= entryTime && c.closeTime < exitTime);
    const observed = [entryPrice, exitPrice, ...held.flatMap(c => [c.high, c.low])];
    const favorable = Math.max(0, ...observed.map(p => side * (p - entryPrice)));
    const adverse = Math.max(0, ...observed.map(p => -side * (p - entryPrice)));
    const stopDistance = Number.isFinite(trade.initialStopDistance) && trade.initialStopDistance > 0 ? trade.initialStopDistance : null;
    const stopped = trade.reason === 'STOP LOSS';
    const after = stopped ? candles.filter(c => c.openTime > exitTime).slice(0, recoveryBars) : [];
    const recovered = after.some(c => side === 1 ? c.high >= entryPrice : c.low <= entryPrice);
    return {
      id: `${index}-${entryTime}-${exitTime}`, side: trade.side || 'LONG', entryTime, exitTime,
      entryPrice, exitPrice, quantity, reason: trade.reason,
      holdingHours: (exitTime - entryTime) / 3600000,
      grossPnL: trade.grossPnL, fees: trade.fees, funding: trade.funding ?? 0,
      netPnL: trade.netPnL, initialStop: trade.initialStop ?? null,
      initialStopDistance: stopDistance,
      initialStopPct: stopDistance === null ? null : stopDistance / entryPrice * 100,
      initialRiskCash: stopDistance === null ? null : stopDistance * quantity,
      observedMfePct: favorable / entryPrice * 100,
      observedMaePct: adverse / entryPrice * 100,
      observedMfeR: stopDistance === null ? null : favorable / stopDistance,
      observedMaeR: stopDistance === null ? null : adverse / stopDistance,
      fullyHeldBars: held.length,
      recovery: stopped ? { barsRequested: recoveryBars, barsAvailable: after.length,
        complete: after.length === recoveryBars,
        entryPriceTouched: recovered ? true : after.length === recoveryBars ? false : null } : null,
    };
  });
  const winners = rows.filter(t => t.netPnL > 0).sort((a, b) => b.netPnL - a.netPnL);
  const stopped = rows.filter(t => t.recovery), completeStops = stopped.filter(t => t.recovery.complete);
  const group = (key, value) => {
    const subset = rows.filter(row => key(row) === value);
    return { label: value, trades: subset.length, netPnL: sum(subset, 'netPnL'),
      fees: sum(subset, 'fees'), funding: sum(subset, 'funding'),
      medianHoldingHours: median(subset.map(t => t.holdingHours)) };
  };
  return {
    schemaVersion: 1,
    method: 'Observed excursions include executed fill prices and fully held candle wicks; partial entry and exit bars are excluded. Excursions are lower bounds, not exact intrabar paths. Slippage is embedded in execution prices, not an additional fee deduction. Recovery means a later candle touched entry price, before costs; it does not prove a wider stop would profit. Recovery windows never extend past this test segment.',
    recoveryBars,
    summary: {
      trades: rows.length, netPnL: sum(rows, 'netPnL'), grossPnL: sum(rows, 'grossPnL'),
      fees: sum(rows, 'fees'), funding: sum(rows, 'funding'),
      medianHoldingHours: median(rows.map(t => t.holdingHours)),
      medianObservedMfePct: median(rows.map(t => t.observedMfePct)),
      medianObservedMaePct: median(rows.map(t => t.observedMaePct)),
      largestWinner: winners[0]?.netPnL ?? null,
      netWithoutLargestWinner: sum(rows, 'netPnL') - (winners[0]?.netPnL ?? 0),
      netWithoutTopThreeWinners: sum(rows, 'netPnL') - sum(winners.slice(0, 3), 'netPnL'),
      stopExits: stopped.length, completeRecoveryWindows: completeStops.length,
      recoveriesInCompleteWindows: completeStops.filter(t => t.recovery.entryPriceTouched).length,
      incompleteRecoveryWindows: stopped.length - completeStops.length,
      tradesWithInitialRisk: rows.filter(t => t.initialStopDistance !== null).length,
    },
    byExit: [...new Set(rows.map(t => t.reason))].map(value => group(t => t.reason, value)),
    byHoldingTime: ['<1h', '1–4h', '4–24h', '≥24h'].map(value => group(t => t.holdingHours < 1 ? '<1h' : t.holdingHours < 4 ? '1–4h' : t.holdingHours < 24 ? '4–24h' : '≥24h', value)),
    trades: rows,
  };
}
module.exports = { buildTradeDiagnostics };
