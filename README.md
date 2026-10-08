# TradeLab V2

Personal paper-trading bot + dashboard.

## Structure

- `backend/` - existing Node trading engine + new API
- `dashboard/` - Next.js TradeLab UI

## Run backend

Open terminal 1:

```bash
cd backend
npm install
npm run api
```

The API listens on `http://127.0.0.1:4000`.

## Run dashboard

Open terminal 2:

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000`.

## Important

This dashboard is PAPER MODE only. It does not contain a Binance live-order endpoint.

Do not run `npm run bot` at the same time as `npm run api`; the API owns the paper bot process when you press Start bot in the dashboard.

The dashboard can:

- start/stop the paper engine
- show portfolio/equity
- show real paper positions
- show completed paper trades
- show risk guard state
- scan the configured symbols with the same strategy logic

Set `NEXT_PUBLIC_API_URL` in `dashboard/.env.local` only if the backend API is hosted somewhere other than `http://127.0.0.1:4000`.
