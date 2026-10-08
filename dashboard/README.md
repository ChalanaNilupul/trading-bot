# TradeLab Dashboard

Modern Next.js dashboard for the personal trading bot. It currently runs with mock data so the UI can be tested safely before the Node backend exposes an API.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Next integration

Replace `lib/mock.ts` with API hooks for the existing Node bot. Recommended endpoints:

- GET /api/status
- GET /api/portfolio
- GET /api/positions
- GET /api/trades
- GET /api/markets
- GET /api/signals
- POST /api/backtests
- GET /api/backtests/:id
- POST /api/paper/start
- POST /api/paper/stop

Keep the UI in PAPER mode until the backend has explicit paper/live separation and a kill switch.
