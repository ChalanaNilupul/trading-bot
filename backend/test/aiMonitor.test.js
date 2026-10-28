const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { AIMonitor, recentReviews } = require("../src/aiMonitor");
const filter = {
  enabled: true,
  provider: "gemini",
  model: "test-model",
  key: "private-secret",
  threshold: 0.75,
  timeout: 8000,
};
const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-monitor-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
test("empty monitor reports safe config without requiring files", (t) => {
  const monitor = new AIMonitor(filter, { dataDir: temp(t) });
  const snapshot = monitor.snapshot(["BTCUSDT"]);
  assert.equal(snapshot.keyConfigured, true);
  assert.deepEqual(snapshot.reviews, []);
  assert.equal(snapshot.lastTest, null);
  assert.ok(!JSON.stringify(snapshot).includes("private-secret"));
});
test("history restores legacy records and classifies errors without exposing extra fields", (t) => {
  const dir = temp(t);
  fs.writeFileSync(
    path.join(dir, "ai_BTCUSDT.jsonl"),
    [
      JSON.stringify({
        candleTime: 10,
        provider: "gemini",
        model: "test",
        allowed: false,
        confidence: 0.4,
        reason: "weak",
        key: "private-secret",
      }),
      "invalid partial row",
      JSON.stringify({
        at: 20,
        allowed: true,
        confidence: 0.9,
        reason: "approved",
        signal: "BUY",
      }),
      JSON.stringify({ at: 30, allowed: false, reason: "AI HTTP 429" }),
      "null",
    ].join("\n"),
  );
  const snapshot = new AIMonitor(filter, { dataDir: dir }).snapshot([
    "BTCUSDT",
    "ETHUSDT",
  ]);
  assert.deepEqual(snapshot.counts, {
    reviewed: 3,
    approved: 1,
    vetoed: 1,
    errors: 1,
  });
  assert.deepEqual(
    snapshot.reviews.map((r) => r.at),
    [30, 20, 10],
  );
  assert.equal(snapshot.reviews[2].candleTime, 10);
  assert.ok(!JSON.stringify(snapshot).includes("private-secret"));
});
test("tail reader bounds large files and limits monitor to 100 reviews", (t) => {
  const dir = temp(t);
  const file = path.join(dir, "ai_BTCUSDT.jsonl");
  fs.writeFileSync(
    file,
    Array.from({ length: 2000 }, (_, at) =>
      JSON.stringify({
        at,
        allowed: true,
        confidence: 1,
        reason: "x".repeat(200),
      }),
    ).join("\n"),
  );
  assert.equal(recentReviews(file, "BTCUSDT").length, 100);
  const snapshot = new AIMonitor(filter, { dataDir: dir }).snapshot([
    "BTCUSDT",
  ]);
  assert.equal(snapshot.reviews.length, 100);
  assert.equal(snapshot.reviews[0].at, 1999);
});
test("connection test persists separately, survives restart, and enforces cooldown", async (t) => {
  const dir = temp(t);
  let calls = 0;
  const provider = {
    ...filter,
    evaluate: async (snapshot) => {
      calls++;
      assert.deepEqual(snapshot.candles, []);
      return { allowed: false, confidence: 0, reason: "No data" };
    },
  };
  const monitor = new AIMonitor(provider, { dataDir: dir, now: () => 1000 });
  assert.equal((await monitor.testConnection()).success, true);
  assert.equal((await monitor.testConnection()).status, 429);
  assert.equal(calls, 1);
  const restored = new AIMonitor(provider, { dataDir: dir }).snapshot([
    "BTCUSDT",
  ]);
  assert.equal(restored.lastTest.success, true);
  assert.equal(restored.reviews.length, 0);
});
test("disabled AI and concurrent tests cannot trigger extra provider calls", async (t) => {
  let calls = 0,
    finish;
  const provider = {
    ...filter,
    evaluate: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const monitor = new AIMonitor(provider, { dataDir: temp(t) });
  const pending = monitor.testConnection();
  assert.equal(monitor.snapshot([]).testing, true);
  assert.equal((await monitor.testConnection()).status, 429);
  finish({ allowed: false, reason: "AI HTTP 429" });
  assert.equal((await pending).success, false);
  assert.equal(monitor.snapshot([]).lastTest.success, false);
  assert.equal(calls, 1);
  assert.equal(
    (await new AIMonitor({ ...provider, enabled: false }).testConnection())
      .status,
    409,
  );
});
