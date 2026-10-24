# TradeLab Live Backend Operations Monitor

## What changed
- Added `GET /api/events?limit=80` for the newest backend events (bounded in-memory buffer; maximum 500 events per API process).
- Added telemetry to `/api/status` and `/api/events`: last successful Binance data update, last processed/scanned candle timestamp, and latest data/API error.
- Instrumented paper-engine start/stop, ticker and candle fetches, strategy signals on newly processed candles, engine entry/exit/risk events, market scan errors, and API errors.
- Added a Live backend operations panel to the dashboard. It refreshes with the existing 5-second dashboard refresh cycle.

## Run it
1. Start the backend from `backen/` using your existing command (`npm run api`).
2. Start the frontend from `frontend/` using your existing command (`npm run dev`).
3. Open the dashboard and start the paper engine. The event feed is shown below the market scanner on Overview.
4. To inspect events directly, open `http://127.0.0.1:4000/api/events?limit=80`.

## Important interpretation
- The monitor reports events emitted by the backend; it does not fabricate exchange activity.
- `PAPER ENGINE RUNNING` means the local simulator loop is running. It does **not** mean real Binance orders are being placed.
- Strategy evaluation is candle-based. With the default `4h` interval, a new strategy decision may only appear when a new 4-hour candle closes. The loop still checks for data on its polling schedule.
- Events are kept in memory and are cleared when the API process restarts. This is intended as an operations monitor, not a permanent audit database.
- The dashboard currently refreshes every five seconds, and market data is cached in the backend. So displayed events and market prices are near-live, not a millisecond stream.

## Validation
- Backend syntax check: `node --check src/api.js` passed.
- Backend self-tests: `npm test` passed (24 tests).
- Frontend production build could not be verified in this environment because dependencies were unavailable/incomplete and `npm ci` timed out. Run `npm ci` then `npm run build` locally to verify the frontend build.
