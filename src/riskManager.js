function calculatePosition({
    balance,
    entryPrice,
    atr,
    riskPercent = 0.01,
    atrStopMultiplier = 2,
    rewardRiskRatio = 2,
    maxPositionPercent = 0.25,
}) {
    if (!balance || !entryPrice || !atr || balance <= 0 || entryPrice <= 0 || atr <= 0) {
        return null;
    }

    const riskAmount = balance * riskPercent;
    const stopDistance = atr * atrStopMultiplier;
    const stopPrice = entryPrice - stopDistance;

    if (stopPrice <= 0) return null;

    const quantityByRisk = riskAmount / stopDistance;
    const maxPositionValue = balance * maxPositionPercent;
    const quantityByCapital = maxPositionValue / entryPrice;

    const quantity = Math.min(quantityByRisk, quantityByCapital);
    const positionValue = quantity * entryPrice;
    const actualRisk = quantity * stopDistance;
    const targetPrice = entryPrice + stopDistance * rewardRiskRatio;

    return {
        quantity,
        positionValue,
        riskAmount,
        actualRisk,
        stopDistance,
        stopPrice,
        targetPrice,
        rewardRiskRatio,
    };
}

module.exports = { calculatePosition };
