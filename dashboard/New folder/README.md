# TradeLab Dashboard

Next.js dashboard for the local Node.js trading engine. The dashboard fetches live backend state from `/api/status`, `/api/markets`, and `/api/trades`; it does not provide real Binance order execution.

**Current backend limitation:** Spot-only, long-only paper simulation. Futures mechanics (leverage, margin, funding, mark price, liquidation and short positions) are not implemented. Do not treat spot paper results as futures results.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. In a separate terminal, start the backend with `npm run api` from the backend folder. The backend binds to `127.0.0.1:4000` by default and allows localhost dashboard origins only.

Set `NEXT_PUBLIC_API_URL` only to a trusted backend URL. Never put an API secret in a `NEXT_PUBLIC_*` variable; those variables are exposed to the browser.
