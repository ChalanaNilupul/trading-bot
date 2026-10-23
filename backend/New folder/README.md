# TradeLab Trading Bot — Spot Paper Only

Requires Node.js 18+. No runtime dependencies.

> **Important:** this project currently implements Binance Spot market data and a long-only paper simulator. It does **not** implement USDⓈ-M/COIN-M futures, short positions, leverage, margin, funding payments, mark price, liquidation, or exchange-side stops. Setting `MARKET_TYPE=futures` intentionally prevents startup. No real orders are submitted.

## Run locally

```bash
npm test
npm run api
```

Keep the API bound to `127.0.0.1` for local use. The dashboard defaults to `http://127.0.0.1:4000`; set `NEXT_PUBLIC_API_URL` if needed. The API allows local dashboard origins only by default.

## API safety configuration

- `API_HOST=127.0.0.1` (recommended; do not expose directly to the internet)
- `API_PORT=4000`
- `API_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`
- If binding to a non-loopback host, `API_TOKEN` is required; every POST request must include `Authorization: Bearer <API_TOKEN>`. Put the token in a trusted server-side proxy or backend client; **never put it in `NEXT_PUBLIC_*` or browser code**.
- `MARKET_TYPE=SPOT_PAPER` is the only supported mode. Other values fail closed.

## Main commands

```bash
npm test
npm run backtest
npm run scan
npm run bot
npm run compare
```

## Before adding futures or using real money

Implement a separate futures exchange adapter and simulator that models isolated/cross margin, leverage, mark price, funding, maintenance margin, liquidation, reduce-only orders, position mode, hedge/one-way mode, precision and exchange-side protective orders. Add exchange sandbox tests and portfolio-wide risk limits. Never reuse the spot simulator's results as futures evidence.
