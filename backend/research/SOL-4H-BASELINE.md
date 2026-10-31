# Reproduce the saved SOLUSDT office baseline

From `backend`:

```powershell
npm run baseline:sol
```

No `.env` or exchange/AI key is required. This is an offline simulator after the
first public-data download. The command reads the committed office report at
`leverage-tests/SOLUSDT-1x.json` and fixes its symbol, direction, timeframe,
starting wallet, leverage, sizing, costs, exchange filters, split, cooldowns and
exact candle dates. It does not read your running bot profile or modify `.env`,
runner state, positions, portfolio risk state, or existing office reports.

The reference is SOLUSDT LONG, Pure Breakout 40/20, 4h, 5,000 candles, 1x and a
1,000 USDT paper wallet, from 2024-07-18 20:00 UTC through 2026-10-30 03:59:59.999
UTC. Its saved full return is approximately +4.20%; later-period return +2.17%
with 12 trades. These are historical observations, not a profit target or a
production approval.

## Outputs

- `data/sol-4h-baseline/candles.json`: validated, contiguous closed 4h candles,
  range metadata and SHA256. A different range or edited checksum is rejected.
- `data/sol-4h-baseline/report.json`: source commit and code hashes, Node version,
  reference hash, input candle hash, office metric comparison and three runs:
  1. Replay the saved pure-breakout office settings.
  2. Compare SMA200-filtered Breakout 40/20 on exactly those candles.
  3. Stress the pure breakout with twice the fee and slippage assumptions.

Each run includes full/in-sample/later-period metrics, buy-and-hold comparison,
individual trades, P/L by exit reason, holding times and risk summaries. The
stress run changes costs only; it does not fit parameters or select a winner.

A `MATCH` means the selected office metrics agree within an absolute tolerance
of 0.000001. `DIFFER` means inspect the expected/actual/delta rows before drawing
conclusions. The original office file did not save its source hashes or raw
input candles, so identical dates/settings do not prove identical original
market-data contents or engine code. No failed reproduction is silently
replaced with a different period.

## Offline repeat

After one successful download:

```powershell
npm run baseline:sol -- --offline
```

This requires the archived candles and makes no data or AI requests. Normal
runs also reuse the existing cache. Reports are overwritten with the latest
run; keep a copy of a report before comparing code revisions. Keep the candle
archive unchanged when investigating code differences.

Send the console table and `data/sol-4h-baseline/report.json` for review. No
credentials are included. Candle files/results stay under ignored `data/`.

## Limits

The office auto-resume setting is preserved for reproduction. This is not a
recommendation to auto-resume a live bot. Neither Gemini nor the shared
portfolio manager is simulated. These already-reviewed historical periods are
not a fresh holdout. Testnet execution/reconciliation, exchange-side protection,
authenticated dashboard access and forward paper validation remain separate
production milestones.
