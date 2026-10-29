const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

test("API specializes one symbol/direction and the portfolio gate permits an eligible paper short", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "single-coin-api-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const end = Math.floor(Date.now() / 900000) * 900000 - 1;
  const candles = Array.from({ length: 1500 }, (_, i) => {
    const close = 200 - i * 0.05,
      openTime = end - (1500 - i) * 900000 + 1;
    return [
      openTime,
      String(close + 0.02),
      String(close + 0.03),
      String(close - 0.03),
      String(close),
      "1000",
      openTime + 899999,
    ];
  });
  fs.writeFileSync(
    path.join(dir, "mock.cjs"),
    `const candles=${JSON.stringify(candles)}; global.fetch=async raw=>{const url=new URL(raw);let data;if(url.pathname.endsWith('/ticker/24hr'))data=[{symbol:'BTCUSDT',lastPrice:'125.05',priceChangePercent:'-1',quoteVolume:'100000000'}];else if(url.pathname.endsWith('/ticker/price'))data={price:'125.05'};else if(url.pathname.endsWith('/klines'))data=candles.filter(c=>!url.searchParams.has('endTime')||c[0]<=Number(url.searchParams.get('endTime'))).slice(-Number(url.searchParams.get('limit')||1500));else if(url.pathname.endsWith('/exchangeInfo'))data={symbols:[{symbol:'BTCUSDT',filters:[{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};else throw Error('Unexpected external request');return {ok:true,json:async()=>data};};`,
  );
  const reserved = net.createServer();
  await new Promise((resolve) => reserved.listen(0, "127.0.0.1", resolve));
  const port = reserved.address().port;
  await new Promise((resolve) => reserved.close(resolve));
  const child = spawn(
    process.execPath,
    [
      "-r",
      path.join(dir, "mock.cjs"),
      path.resolve(__dirname, "../src/api.js"),
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: String(port),
        API_KEY: "single-coin-test-key",
        AI_ENABLED: "0",
        BOT_SYMBOL: "BTCUSDT",
        SYMBOLS: "ETHUSDT,SOLUSDT",
        DIRECTION: "SHORT",
        STRATEGY: "Breakout 50/20",
        INTERVAL: "15m",
        LEVERAGE: "1",
        RISK_PERCENT: "0.0025",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("API startup timed out")),
      10000,
    );
    child.stdout.on("data", (data) => {
      if (String(data).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`API exited ${code}`));
    });
  });
  const base = `http://127.0.0.1:${port}`,
    headers = {
      "X-API-Key": "single-coin-test-key",
      "Content-Type": "application/json",
    };
  assert.equal(
    (await fetch(base + "/api/train", { method: "POST", body: "{}" })).status,
    401,
  );
  const before = await (await fetch(base + "/api/status", { headers })).json();
  assert.deepEqual(before.symbols, ["BTCUSDT"]);
  assert.equal(before.direction, "SHORT");
  assert.equal(before.portfolio.startingBalance, 1000);
  const tick = await fetch(base + "/api/bot/tick", { method: "POST", headers });
  assert.equal(tick.status, 200);
  const after = await tick.json();
  assert.equal(after.runners.length, 1);
  assert.equal(after.runners[0].position?.side, "SHORT");
  assert.ok(
    !after.runners[0].lastNote.includes("All runners are not available"),
  );
  const files = fs.readdirSync(path.join(dir, "data"));
  assert.ok(files.some((f) => f.endsWith("_short.json")));
  const trained = await fetch(base + "/api/train", {
    method: "POST",
    headers,
    body: JSON.stringify({
      symbol: "BTCUSDT",
      direction: "SHORT",
      interval: "15m",
      candles: 1500,
    }),
  });
  const report = await trained.json();
  assert.equal(trained.status, 200, JSON.stringify(report));
  assert.equal(report.direction, "SHORT");
  assert.equal(report.aiIncluded, false);
  assert.equal(report.candidates.length, 9);
  const unchanged = await (
    await fetch(base + "/api/status", { headers })
  ).json();
  assert.equal(unchanged.runners[0].position.side, "SHORT");
  assert.equal(unchanged.strategy, "Breakout 50/20");
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
});
