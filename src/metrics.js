function computeMetrics({ trades, equityCurve = [], startingBalance, periodsPerYear = 0 }) {
    const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : startingBalance;

    // Per-candle equity returns -> Sharpe / Sortino / max drawdown
    let sharpe = 0, sortino = 0, maxDrawdown = 0;
    if (equityCurve.length > 2) {
        const rets = [];
        let peak = equityCurve[0].equity;
        for (let i = 1; i < equityCurve.length; i++) {
            rets.push(equityCurve[i].equity / equityCurve[i - 1].equity - 1);
            peak = Math.max(peak, equityCurve[i].equity);
            maxDrawdown = Math.max(maxDrawdown, (peak - equityCurve[i].equity) / peak);
        }
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
        const std = Math.sqrt(variance);
        const downside = Math.sqrt(rets.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / rets.length);
        const ann = Math.sqrt(periodsPerYear || 1);
        sharpe = std > 0 ? (mean / std) * ann : 0;
        sortino = downside > 0 ? (mean / downside) * ann : 0;
    }

    const winners = trades.filter(t => t.netPnL > 0);
    const losers = trades.filter(t => t.netPnL <= 0);
    const grossProfit = winners.reduce((s, t) => s + t.netPnL, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.netPnL, 0));
    const avgWin = winners.length ? grossProfit / winners.length : 0;
    const avgLoss = losers.length ? grossLoss / losers.length : 0;

    let streak = 0, maxLossStreak = 0;
    for (const t of trades) {
        streak = t.netPnL <= 0 ? streak + 1 : 0;
        maxLossStreak = Math.max(maxLossStreak, streak);
    }

    const byReason = {};
    for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;

    return {
        startingBalance,
        finalEquity,
        returnPct: ((finalEquity / startingBalance) - 1) * 100,
        trades: trades.length,
        winRate: trades.length ? (winners.length / trades.length) * 100 : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        expectancy: trades.length ? trades.reduce((s, t) => s + t.netPnL, 0) / trades.length : 0,
        avgR: trades.length ? trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / trades.length : 0,
        avgWin,
        avgLoss,
        payoff: avgLoss > 0 ? avgWin / avgLoss : 0,
        fees: trades.reduce((s, t) => s + t.fees, 0),
        maxDrawdownPct: maxDrawdown * 100,
        sharpe,
        sortino,
        maxLossStreak,
        byReason,
    };
}

function printMetrics(label, m, buyHoldPct = null) {
    const pf = m.profitFactor === Infinity ? "inf" : m.profitFactor.toFixed(2);
    console.log(`\n--- ${label} ---`);
    console.log(`Return:        ${m.returnPct.toFixed(2)}%` + (buyHoldPct !== null ? `   (buy & hold: ${buyHoldPct.toFixed(2)}%)` : ""));
    console.log(`Final equity:  $${m.finalEquity.toFixed(2)}  (start $${m.startingBalance.toFixed(2)})`);
    console.log(`Max drawdown:  ${m.maxDrawdownPct.toFixed(2)}%`);
    console.log(`Sharpe/Sortino: ${m.sharpe.toFixed(2)} / ${m.sortino.toFixed(2)}`);
    console.log(`Trades:        ${m.trades}   win rate ${m.winRate.toFixed(1)}%   max losing streak ${m.maxLossStreak}`);
    console.log(`Profit factor: ${pf}   expectancy $${m.expectancy.toFixed(2)}/trade   avg R ${m.avgR.toFixed(2)}`);
    console.log(`Avg win/loss:  $${m.avgWin.toFixed(2)} / $${m.avgLoss.toFixed(2)}   payoff ${m.payoff.toFixed(2)}`);
    console.log(`Fees paid:     $${m.fees.toFixed(2)}`);
    console.log(`Exits:         ${Object.entries(m.byReason).map(([k, v]) => `${k}=${v}`).join("  ") || "none"}`);
}

module.exports = { computeMetrics, printMetrics };
