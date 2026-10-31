# Binance USDⓈ-M demo execution

This optional mode submits orders with virtual funds to **https://demo-fapi.binance.com**.
Production order execution is not implemented: the demo client fixes that host,
rejects redirects and rejects other hosts/unsupported operations. Default mode
remains `FUTURES_PAPER`; adding credentials alone never enables orders.

## 1. Prepare your demo account and backend configuration

Create an HMAC API key/secret in Binance **Demo Trading → API Management**,
not your production account's API Management. Keep the credentials in
`backend/.env` only. Existing `API_KEY` / dashboard `BOT_API_KEY` authenticate
the local dashboard and are unrelated. Never add Binance secrets to dashboard
variables or commit `.env`.

Use a dedicated Futures demo account with no manual positions or orders. Set
One-way position mode and Single-Asset mode manually while flat; the bot verifies
these without changing account-wide modes. SOLUSDT must be available for trading.

Add/update the following in `backend/.env`, preserving your dashboard and AI keys:

```dotenv
BOT_MODE=FUTURES_DEMO
BINANCE_DEMO_API_KEY=your_demo_key
BINANCE_DEMO_API_SECRET=your_demo_secret
BOT_SYMBOL=SOLUSDT
DIRECTION=LONG
LEVERAGE=1
START_BALANCE=1000
RISK_PERCENT=0.0025
MAX_MARGIN_PERCENT=0.10
DEMO_MAX_NOTIONAL_USDT=25
DEMO_ALLOW_ENTRIES=0
AUTOSTART=0
```

Keep your current supported fixed-stop strategy/interval, for example
`STRATEGY=Pure Breakout 40/20` with `INTERVAL=4h`. Multi-timeframe/retest variants
require `INTERVAL=15m`. Trailing stops and fixed-profit-target strategies are
rejected in this initial integration. Strategy selection remains experimental;
this feature does not establish profitability.

Demo equity displayed by the bot is the allocated starting budget plus changes
in the exchange wallet and current position P/L. It is distinct from the demo
account's entire wallet. Entry sizing uses at most the allocated budget, risk
limit, margin limit, free collateral, exchange limits and the explicit entry
notional cap. Initial defaults are $1,000 allocated budget and $25 maximum entry
notional, not 10% of a potentially very large demo account. The minimum exchange
notional/quantity must fit inside that cap. Do not reset demo funds, deposit or
trade manually while the bot owns positions: these alter accounting/ownership.

## 2. Run the read-only connection check

From `backend`, using Node 22 or newer:

```powershell
npm test
npm run demo:check
```

The check synchronizes server time and reads account mode, balances, positions,
orders, SOLUSDT configuration and exchange filters. It makes no order/settings
mutations and does not print credentials. A failed check must be resolved before
starting execution. Use only supported access if Binance rejects your region;
there is no fallback to production or another host.

## 3. Test one explicit demo round trip

Stop the backend process with Ctrl+C first. A dashboard Stop does not release
the process lock. Leave the dashboard closed or disconnected during the CLI test.
Set `DEMO_ALLOW_ENTRIES=1`, then run:

```powershell
npm run demo:smoke
```

This command intentionally places a capped LONG market order, confirms a
Binance-held mark-price protective stop, sends a reduce-only close and reconciles
actual fills/USDT fees/funding. It is an execution test, not a strategy signal;
AI is excluded. Check Binance Demo order history too. It requires a flat,
reconciled account with no fault and respects the portfolio/risk gate. A completed
test leaves the position flat and records its trade in the isolated demo state.
If reconciliation stays pending or a request fails, preserve the state files and
start the demo API to continue recovery. Do not repeat entry commands to work
around an unknown order response.

## 4. Start dashboard execution

With `BOT_MODE=FUTURES_DEMO`, run the existing backend and dashboard in separate
terminals:

```powershell
# backend terminal
npm run api
```

```powershell
# repository root, another terminal
npm --prefix dashboard run dev
```

The dashboard Overview displays the DEMO banner, account wallet, allocated budget,
entry cap, protection state, pending reconciliation and fault. Press Start bot to
begin polling. `DEMO_ALLOW_ENTRIES=0` blocks new entries; protection and exits for
previously owned positions can still be managed while polling runs. Restart the
backend after changing environment settings. A fresh profile checkpoints the
latest closed candle without entering on an old signal; then it acts only on new
closed candles. Normal strategy entries older than two minutes are skipped,
including after slow AI/account checks; use the default 60-second polling interval. Optional AI may veto strategy entries but cannot veto protective
management or exits.

For a terminal-only runner use `npm run demo` instead of the API. Never run both
against the same account/data directory. The process lock prevents two processes
in one directory; it cannot protect against another machine or checkout, so use
only one bot instance per demo account.

**Stop bot** stops polling/new entries and saves state; it does not flatten an
exchange position or cancel its existing protective stop. Use **Close bot’s demo
position** to request a managed close. That action only manages this bot's known
position/orders. Polling should remain running until positions, orders and
accounting are confirmed settled. Closing the dashboard alone does not stop the
backend.

## Recovery and boundaries

- Demo state/trade logs and portfolio risk use separate filenames from paper.
  Keep the `data/state_demo_*.json` files and `data/demo-portfolio-risk-state.json`
  across restarts. A corrupt/mismatched profile or key blocks adoption. The lock
  file records the process PID; a dead process's lock is reclaimed on restart.
- Each mutation is journaled before sending its unique client order ID. Network/
  5xx uncertainty is resolved by querying that ID; entries/closes are never blindly
  resubmitted. An unresolved ID blocks new entries and may need manual investigation.
  Do not delete state to clear an unknown order.
- Market entries use actual exchange fills. Partial fills trigger cancellation of
  the remainder and a protected reduce-only flatten, followed by a fault. A filled
  position without a verified stop triggers an attempted reduce-only flatten.
  A network outage can prevent both protection and emergency close; reconnect and
  continue reconciliation, and inspect the Binance demo account directly.
- Stops use the current Algo Order API (`STOP_MARKET`, `closePosition=true`,
  `MARK_PRICE`). Stop prices round upward to the exchange tick for LONG positions.
  Market quantity respects the common lot/market-lot step. Slippage is not simulated
  on top of exchange fills. The post-fill entry-notional cap allows 1% tolerance;
  excess actual entry notional triggers a managed close. A rising mark price alone
  does not trigger the cap.
- Foreign orders/positions and unexpected fills are not adopted, cancelled or
  silently included in results. Use a dedicated account. Only complete USDT
  commissions/funding accounting is supported; unsupported currency or truncated
  history blocks new entries until reconciled. History is queried in daily chunks;
  a full 1,000-row chunk or trade longer than 89 days requires manual review.
- Risk limits include daily loss/drawdown halts, loss-streak cooldown and trade
  count, plus the existing portfolio gate. A flat, fully reconciled fault can be
  reset through the dashboard's existing risk-reset action. Unknown in-flight
  operations cannot be reset away.
- Execution/account reconciliation uses REST polling, not WebSocket streaming.
  Exchange-held stops remain active between polls, but UI/risk updates can lag.
  The first integration is for demo testing; exchange-specific authenticated
  behaviour must be verified with your own demo credentials before relying on it.

The implementation follows Binance's current demo host and conditional-order API:

- https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info
- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade

### Transient market-data errors

A GET ticker/candle/account failure does not mean an order submission failed.
Demo reads retry once after 300 ms for network/invalid-response failures, HTTP
408 or 5xx (five-second timeout per read attempt). Each private read is signed
again with a fresh timestamp. Authentication errors, missing-order responses,
403/418 blocks and 429 rate limits are not retried. Mutations retain their
eight-second timeout and are never automatically retried. Ticker reads request
SOLUSDT only, and overlapping dashboard/runner ticker refreshes share one request.
If reads continue failing, investigate connectivity or Binance demo availability;
never delete execution journals or rerun the smoke order to repair a data read.
