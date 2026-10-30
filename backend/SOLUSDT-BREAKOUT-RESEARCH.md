# SOLUSDT Breakout Research Baseline

This branch adds a pure Donchian breakout candidate so it can be compared with the
existing SMA200-filtered breakout. It does not enable live orders.

## Comparison configurations

Run both strategies against the same historical candles and engine assumptions:

- Market: Binance USDⓈ-M Futures, SOLUSDT
- Interval: 15m
- Starting paper balance: 1,000 USDT
- Leverage: 1x
- Direction: LONG
- Strategy A: `Pure Breakout 40/20` (no SMA200 entry filter)
- Strategy B: `Breakout 40/20` (requires close above SMA200)
- Entry: candle close above the highest high of the preceding 40 completed candles
- Exit: candle close below the lowest low of the preceding 20 completed candles
- Trailing: disabled by the strategy
- Keep fees, slippage, funding, risk sizing, and guardrails identical between runs.

The existing strategy engine queues entries for the next candle open. Review the
reported execution assumptions and ensure that both runs use the same candle range.
Use the out-of-sample results as the primary comparison; do not select a strategy
from in-sample return alone.

## Safety

This is research/backtesting only. Do not enable production order placement based on
these results. Funding and liquidation are modeled estimates, not exact exchange
simulation. No profitability is implied by adding this candidate; run tests and
historical comparisons before drawing conclusions.
