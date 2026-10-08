/** Round a quantity DOWN to the exchange's lot step (e.g. 0.0001). */
function floorToStep(value, step) {
    if (!step || step <= 0) return value;
    const decimals = Math.max(0, Math.round(-Math.log10(step)));
    return Number((Math.floor(value / step + 1e-9) * step).toFixed(decimals));
}

/**
 * Per-trade position sizing.
 * Risk-based: lose at most riskPercent * riskMultiplier of balance if the stop is hit.
 * Capped by available cash (spot, no leverage) and maxPositionPercent.
 * Rejects trades whose expected reward doesn't comfortably beat round-trip costs.
 */
function calculatePosition({
    balance,
    entryPrice,
    atr,
    riskPercent = 0.01,
    riskMultiplier = 1,
    atrStopMultiplier = 2,
    rewardRiskRatio = 2,
    maxPositionPercent = 0.5,
    feeRate = 0.001,
    slippage = 0.0005,
    minRewardToCost = 3,
    stepSize = null,
    minNotional = 0,
}) {
    if (!balance || !entryPrice || !atr || balance <= 0 || entryPrice <= 0 || atr <= 0) return null;

    const stopDistance = atr * atrStopMultiplier;
    const stopPrice = entryPrice - stopDistance;
    if (stopPrice <= 0) return null;

    // Cost filter: skip setups where fees + slippage eat the edge.
    const rewardPct = (stopDistance * rewardRiskRatio) / entryPrice;
    const roundTripCostPct = 2 * feeRate + 2 * slippage;
    if (rewardPct < minRewardToCost * roundTripCostPct) return null;

    const riskAmount = balance * riskPercent * riskMultiplier;
    const quantityByRisk = riskAmount / stopDistance;

    const maxPositionValue = Math.min(balance * maxPositionPercent, balance / (1 + feeRate));
    const quantityByCapital = maxPositionValue / entryPrice;

    let quantity = Math.min(quantityByRisk, quantityByCapital);
    quantity = floorToStep(quantity, stepSize);

    const positionValue = quantity * entryPrice;
    if (quantity <= 0 || positionValue < minNotional) return null;

    const actualRisk = quantity * stopDistance;

    return {
        quantity,
        positionValue,
        riskAmount,
        actualRisk,
        effectiveRiskPct: (actualRisk / balance) * 100,
        cappedByCapital: quantityByCapital < quantityByRisk, // true = the position cap, not your risk %, set the size
        stopDistance,
        stopPrice,
        targetPrice: entryPrice + stopDistance * rewardRiskRatio,
        rewardRiskRatio,
    };
}

module.exports = { calculatePosition, floorToStep };
