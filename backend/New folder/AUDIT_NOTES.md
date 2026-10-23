# TradeLab audit notes (2026-10-22)

## Critical scope finding
- Backend data and symbol filters use Binance Spot REST endpoints (`/api/v3/klines`, `/api/v3/exchangeInfo`).
- Engine only models cash-funded long positions. It does not model futures shorting, leverage, margin, funding, mark price, liquidation, reduce-only orders, or exchange-side stops.
- No live order submission was found. The project is paper-only.
- `MARKET_TYPE` is now fail-closed: only `SPOT_PAPER` is accepted. Setting it to `futures` exits with a clear error instead of creating a misleading futures simulation.

## Changes made
- `src/api.js`: explicit spot-paper mode fields; reject unsupported market modes; restrict CORS to configured origins; require JSON content type on POST; require `API_TOKEN` for non-loopback binds; cap backtest body at 8 KB; validate symbol, interval, candle count, fee, slippage, split and halt-resume inputs.
- `components/dashboard.tsx`: command responses now check HTTP/API errors; settings clearly state that this is spot long-only and that futures are unsupported; dashboard labels are explicit.
- `README.md` (backend): replaced outdated/general instructions with actual scope, safe local run instructions and a checklist for a future futures implementation.
- `README.md` (frontend): documents that the dashboard consumes the backend API and warns against interpreting it as futures performance.

## Verified
- `npm test`: 24 self-tests pass.
- `node --check src/api.js`: passes.
- Runtime smoke test: health/status respond; unsupported Origin gets HTTP 403; POST without JSON content type gets HTTP 415.
- `MARKET_TYPE=futures node src/api.js`: intentionally exits with an unsupported-mode error.

## Still unresolved / must be addressed before live or futures use
1. Each symbol runner currently has its own independent simulated balance (`START_BALANCE`, default 1000). Aggregated equity therefore is not a shared portfolio and does not enforce cross-symbol capital reservation. API now labels this model explicitly, but it is not fixed into a shared allocator yet.
2. The existing risk guard is per runner, not portfolio-wide. A portfolio-level futures risk manager is required.
3. The dashboard build was not run in this environment because frontend dependencies were not installed here. UI changes were checked by source inspection only.
4. Do not add live orders until an independent exchange adapter, idempotent order lifecycle, account reconciliation, server-side protection and failure/restart tests exist.
