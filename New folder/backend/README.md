# TradeLab — Binance USDⓈ-M Futures Paper Bot

Requires Node.js 18+. No third-party npm dependencies. **This project is paper-only: it uses public Binance Futures market-data endpoints and contains no signed order-placement implementation. `liveOrdersEnabled` is always `false`.**

## Run

```bash
npm test
npm run api
```

In another terminal, start the continuous paper engine from the dashboard or:

```bash
curl -X POST http://127.0.0.1:4000/api/bot/start
```

Stop it with `POST /api/bot/stop`. The API defaults to `127.0.0.1:4000`.

## Futures paper model

- Public market data: Binance USDⓈ-M Futures (`fapi.binance.com`) klines, 24h tickers and exchange filters.
- Position sides: long and short; `BUY` opens long or closes short, `SELL` opens short or closes long.
- Default leverage: **5x**; isolated-margin accounting per symbol sub-account.
- Default total starting wallet: **1000 USDT**, divided equally across configured symbols. With 8 symbols, each isolated paper sub-account starts with 125 USDT. This is intentional; the dashboard aggregate sums to 1000 USDT, not 8000 USDT.
- Default taker-fee estimate: 0.05% per fill; slippage estimate: 0.05%; estimated funding rate: 0.01% each 8-hour boundary. Actual fees/funding depend on your account, symbol and time; these defaults are assumptions, not live account values.
- ATR stop-loss and take-profit, optional trailing stop, risk-based sizing, leverage/margin caps, simulated liquidation price and liquidation handling.
- Risk controls: 3% daily loss, 10% max drawdown kill switch, 3 consecutive losses cooldown, max 6 entries/day, risk throttle after drawdown.
- State and trade files are saved with `futures` in their names so previous spot state is not accidentally loaded.

## Environment variables

| Variable | Default | Meaning |
|---|---:|---|
| `API_PORT` | `4000` | API port |
| `API_HOST` | `127.0.0.1` | Bind address |
| `SYMBOLS` | 8 liquid majors | Comma-separated USDT symbols |
| `INTERVAL` | `4h` | Candle interval |
| `POLL_SECONDS` | `60` | How often to check for closed candles |
| `START_BALANCE` | `1000` | Total paper wallet across symbol sub-accounts (USDT) |
| `LEVERAGE` | `5` | Simulated leverage (clamped 1–125x) |
| `FEE_RATE` | `0.0005` | Fee per fill (0.05%) |
| `SLIPPAGE` | `0.0005` | Simulated market-fill slippage (0.05%) |
| `FUNDING_RATE_8H` | `0.0001` | Estimated funding rate per 8h boundary (0.01%) |
| `RISK_PERCENT` | `0.01` | Equity risk budget per trade (1%) |
| `MAX_MARGIN_PERCENT` | `0.25` | Max initial margin allocation per symbol sub-account (25%) |
| `STRATEGY` | `Breakout 50/20` | Strategy name from `src/strategies.js` |
| `RESET_HALT` | unset | Set to `1` to reset halted guards on startup after reviewing the cause |
| `AUTOSTART` | unset | Set to `1` to start the API's paper loop automatically |

## API

- `GET /api/health` — mode and running status
- `GET /api/status` — portfolio equity, margin, per-symbol positions, risk and telemetry
- `GET /api/positions` — open paper positions
- `GET /api/trades` — recent completed paper trades
- `GET /api/markets` — current signal scan from Futures market data
- `GET /api/events?limit=80` — recent backend activity
- `POST /api/bot/start` and `/api/bot/stop` — control paper engine
- `POST /api/bot/tick` — request one manual tick
- `POST /api/risk/reset-halt` — reset paper risk guards

`/api/backtest` is the legacy spot backtest route and has not been converted to a futures backtester. Do not use its results to validate this futures paper engine. The Futures engine is a simplified simulator, not an exact replica of Binance's margin tier, mark-price, liquidation-fee, funding settlement, or execution rules. Test and validate before relying on its statistics.

## Tests

```bash
npm test
```

Tests cover strategy causality, existing spot engine regression tests, futures long/short accounting paths, isolated liquidation simulation, funding-boundary handling, and state restoration.
