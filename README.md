# Trading Bot v3 (paper trading)

Requires Node 18+. No dependencies.

```bash
npm test                          # 22 self-tests (indicators, risk, guard, engine accounting, no-lookahead)
npm run backtest                  # SYMBOL=BTCUSDT INTERVAL=15m CANDLES=20000 ... (downloads + caches candles)
npm run scan                      # ranks the most liquid USDT pairs by signal
npm run bot                       # continuous paper bot, state in data/state_*.json
```

Offline demo: `node tools/synth.js data/synthetic.json 20000 && DATA_FILE=data/synthetic.json npm run backtest`
(synthetic data only checks the plumbing, never judge the strategy on it).

## Architecture

| File | Role |
|---|---|
| `indicators.js` | O(n) indicator series (SMA/EMA/RSI/ATR/MACD/ADX), causal, shared by backtest + live |
| `strategy.js` | Pure `evaluate()` scoring + ADX regime filter |
| `riskManager.js` | Per-trade sizing, cost filter, exchange lot-step rounding |
| `riskGuard.js` | Account-level: daily loss limit, drawdown kill switch, loss-streak cooldown, trades/day cap, drawdown throttle |
| `engine.js` | ONE execution model for backtest and live: next-open fills, slippage, gap-aware stops, trailing stop |
| `backtester.js` | Same timeframe as live, slippage, Sharpe/Sortino, buy&hold, in/out-of-sample split, CSV trade log |
| `index.js` | Live loop: acts once per closed candle, persists state, restart-safe, Telegram alerts (optional) |

## Env vars

`SYMBOL`, `INTERVAL`, `CANDLES`, `FEE_RATE`, `SLIPPAGE`, `TRAILING=0`, `SPLIT`, `VERBOSE=1`, `REFRESH=1`,
`HALT_RESUME_DAYS` (backtest only), `POLL_SECONDS`, `ONE_SHOT=1`, `RESET_HALT=1`,
`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

## Tuning the guard

Edit the defaults in `riskGuard.js` (or pass `guard: {...}` to `new Engine`):
`maxDailyLossPct 3%`, `maxDrawdownPct 10%`, `maxConsecutiveLosses 3` (4h cooldown), `maxTradesPerDay 6`.

## Before any real money

1. Backtest several coins and years; require out-of-sample profit factor > 1.3 with 100+ trades.
2. Paper trade this bot for weeks; compare live results with the backtest.
3. Real orders are NOT implemented yet. When added: API key without withdrawal rights, exchange-side
   stop (OCO) orders, start with a tiny amount.
