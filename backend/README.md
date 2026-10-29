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
- The live paper runner evaluates only the newest newly closed candle for signals. When it detects a signal, it estimates an immediate fill from Binance's current last-traded price plus configured slippage; missed candles are still replayed for existing-position stops/funding but cannot trigger stale entries. This is a paper approximation, not an exchange fill or order-book simulation.

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

## Optional AI entry review (OpenAI or Gemini)

AI is **disabled by default**. It is an experimental veto on strategy BUY/SHORT
entries in the continuous paper runner (CLI and API). It never creates signals,
changes sizing/stops/leverage, or blocks exits. Existing positions do not wait on
AI. Only the latest closed candle is reviewed; the last 60 closed candles and
strategy indicators are sent to the selected AI provider. No account credentials are sent.

1. Copy `.env.example` to `.env` inside `backend`.
2. Set `AI_ENABLED=1` and choose a provider:
   - `AI_PROVIDER=openai` (default): set backend-only `OPENAI_API_KEY` and
     `AI_MODEL` to a model supporting Chat Completions structured outputs.
   - `AI_PROVIDER=gemini`: set backend-only `GEMINI_API_KEY` and `AI_MODEL` to
     an available Gemini model supporting Generate Content structured outputs.
     Use the bare model ID, without `models/`. OpenAI credentials are not required.
   Only the selected provider is called; there is no automatic fallback or dual review.
3. For the dashboard, set `API_KEY` separately (at least 16 characters).
4. With Node 20.6+, run `node --env-file=.env src/index.js` for CLI paper trading,
   or `node --env-file=.env src/api.js` for the dashboard backend. On Node 18,
   export variables through your shell/process manager; `.env` is not auto-loaded.

Do not put either provider key in browser code or `NEXT_PUBLIC_*` variables. Never
commit `.env`. Requests use the selected provider's fixed official endpoint, an 8-second
configurable timeout, structured responses, and no retries. API failures,
refusals, invalid output, and low confidence veto new entries. Confidence is a
subjective model score, **not** a win probability. Reviews incur API charges.
Decisions include the provider and model and are recorded in `data/ai_SYMBOL.jsonl`; the latest review is included
in the runner's signal note. Execution price is refreshed after the review.

Historical backtests and market scans remain strategy-only: **they do not
validate AI-filtered performance**. Compare separate baseline and AI paper runs
on the same dates and symbols, with fees, slippage and funding; keep their data
directories separate. Evaluate net return, drawdown, number of trades and API
cost over an adequate unseen sample. Do not tune confidence or strategy settings
on the evaluation period. An LLM can know historical outcomes, so querying it on
old candles is not a reliable unbiased historical backtest. No profitability
improvement is established by this integration, and no real orders are enabled.

### Gemini configuration example

```dotenv
AI_ENABLED=1
AI_PROVIDER=gemini
GEMINI_API_KEY=your_private_key
AI_MODEL=your_available_gemini_model_id
```

Restart the backend after changing provider settings. You can keep both keys in
your private environment, but choose one provider and matching model per run.
Gemini requests use the `x-goog-api-key` header, never a URL query parameter.
Blocked, truncated, empty, or malformed Gemini replies veto the entry just like
OpenAI failures. Model availability, quotas, pricing and data handling depend on
your selected provider/account. This integration does not make a paid request
until enabled and an entry signal needs review.

Gemini API references: [structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
and [Generate Content](https://ai.google.dev/api/generate-content).

## AI Monitor dashboard

Open **AI Monitor** in the dashboard sidebar to see enabled/disabled status,
provider/model, whether the key is configured (the key is never returned),
confidence threshold, timeout, and the latest 100 saved entry reviews. Missing
history files show “No trading reviews yet”; files are created after the first
eligible review. The earlier terminal connection-test command does not write a
review file.

**Test connection** sends one explicitly requested provider call with no candle
data and never opens a position. A valid rejection counts as a successful
connection. Tests may incur API charges; the button has a 30-second server-side
cooldown. Results are saved separately from trade reviews and survive restarts.
No AI calls are made by viewing or refreshing the monitor.

Authenticated routes: `GET /api/ai` (safe config/history) and `POST /api/ai/test`
(connection test). Both pass through the dashboard's server-side proxy. Backend
credentials stay in `backend/.env`; use `node --env-file=.env src/api.js` with
Node 20.6+ so that file is loaded. Keep `BOT_API_KEY` in `dashboard/.env.local`
identical to backend `API_KEY`, and set `BOT_API_URL=http://127.0.0.1:4000`.
Restart both services after updating. The UI refreshes monitor data every five
seconds, independently of market scanning.

## Single coin, long-only or short-only paper bot

The **Single Coin Lab** dashboard page compares fixed presets for one symbol,
one direction and one timeframe. This is historical research, not ML model
training, Gemini fine-tuning, or Binance Grid trading. A LONG profile only opens
longs; a SHORT profile uses explicit bearish entries and buys to cover. Stop,
liquidation, funding and risk handling use the same Futures engine in research
and paper runs. The old `SHORTS` variable is superseded by `DIRECTION`.

1. Choose a coin, LONG/SHORT, timeframe and 1,500–20,000 candles in the lab.
2. Compare presets. The first 60% trains/screens, the next 20% selects the
   candidate, and only that candidate is evaluated on the last 20%. Indicator
   warmup reduces usable training data. Changing settings after seeing the
   final segment makes it development data; use a new untouched period next.
3. A candidate must have positive training return and PF >1; validation needs
   at least 30 trades, PF >=1.2, positive return and drawdown <=10%. The final
   screen needs >=10 trades, positive return, PF >1 and drawdown <=10%.
   These fixed research filters do not establish statistical significance or
   future profitability. No candidate is a valid outcome.
4. Only after a historical pass does the lab produce `.env` settings. They are
   never applied automatically. Stop the old profile, review/close its paper
   positions, replace the settings in `backend/.env`, restart, and click Start
   bot. Forward paper testing is still necessary. The current running profile
   is displayed separately from the lab's selections.

For manual single-coin research, set these in `backend/.env` (example only):

```dotenv
BOT_SYMBOL=BTCUSDT
DIRECTION=SHORT
STRATEGY=Breakout 50/20
INTERVAL=4h
START_BALANCE=1000
LEVERAGE=1
RISK_PERCENT=0.0025
MAX_MARGIN_PERCENT=0.10
```

`BOT_SYMBOL` overrides `SYMBOLS`/`SYMBOL` and must be one symbol. The full
configured paper wallet belongs to that one runner. `DIRECTION` defaults to LONG;
BOTH is supported by the backend for research but is not the single-direction
lab mode. The original scoring strategy has no short implementation and is
rejected for SHORT/BOTH. Breakout shorts enter below the prior entry-channel
low while below SMA200 and cover above the exit-channel high. EMA shorts use a
bearish EMA stack and rejection of EMA20; RSI shorts sell overbought rallies
below SMA200; trend shorts require price and SMA50 below SMA200. A long exit
SELL is never blindly converted into a short entry.

Explicit single-coin/direction profiles use direction-specific state and trade
filenames, separate from previous multi-coin paper state. Switching profiles
does not transfer or close the old positions. The shared portfolio risk state
is retained; changing direction must not silently reset its halt. Backtest
results show the requested direction and do not activate paper settings.

The lab is authenticated `POST /api/train`. It makes no AI calls, assumes
estimated fees/slippage/fixed funding, uses 1x leverage and 0.25% planned risk,
and disables backtest auto-resume after a halt. It does not simulate the shared
portfolio risk manager. The running paper bot still uses the existing AI and
portfolio risk gates. Research reports are displayed for the current page
session; they are not trained model files. The existing CLI `npm run tournament`
also respects `BOT_SYMBOL` and `DIRECTION` and includes direction in its CSV names;
it remains exploratory because its ranking uses out-of-sample results.
