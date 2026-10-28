const fs = require("fs");
const path = require("path");
const store = require("./store");

// Bound disk reads even after long paper runs; tolerate missing files and partial writes.
function recentReviews(file, symbol, limit = 100) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 128 * 1024);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines
      .flatMap((line) => {
        try {
          const row = JSON.parse(line);
          if (
            typeof row.allowed !== "boolean" ||
            typeof row.reason !== "string"
          )
            return [];
          const confidence =
            Number.isFinite(row.confidence) &&
            row.confidence >= 0 &&
            row.confidence <= 1
              ? row.confidence
              : null;
          const candleTime = Number.isFinite(row.candleTime)
            ? row.candleTime
            : null;
          const at = Number.isFinite(row.at) ? row.at : candleTime;
          if (!Number.isFinite(at)) return [];
          // Whitelist fields: never send keys, raw provider payloads or snapshots to the browser.
          return [
            {
              symbol,
              at,
              candleTime,
              provider: String(row.provider || "unknown").slice(0, 40),
              model: String(row.model || "unknown").slice(0, 120),
              signal: String(row.signal || "—").slice(0, 20),
              interval: String(row.interval || "—").slice(0, 20),
              strategy: String(row.strategy || "—").slice(0, 100),
              allowed: row.allowed,
              confidence,
              reason: row.reason.slice(0, 300),
              outcome:
                confidence === null
                  ? "error"
                  : row.allowed
                    ? "approved"
                    : "vetoed",
            },
          ];
        } catch {
          return [];
        }
      })
      .slice(-limit);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("AI review history could not be read");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

class AIMonitor {
  constructor(filter, { dataDir = "data", now = Date.now } = {}) {
    this.filter = filter;
    this.dataDir = dataDir;
    this.now = now;
    this.testing = false;
    this.nextTestAt = 0;
  }

  snapshot(symbols) {
    const reviews = symbols
      .flatMap((symbol) =>
        recentReviews(path.join(this.dataDir, `ai_${symbol}.jsonl`), symbol),
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 100);
    const tests = recentReviews(
      path.join(this.dataDir, "ai_connection_tests.jsonl"),
      "CONNECTION TEST",
      10,
    ).sort((a, b) => b.at - a.at);
    return {
      enabled: this.filter.enabled,
      provider: this.filter.provider,
      model: this.filter.model || null,
      keyConfigured: !!this.filter.key?.trim(),
      minConfidence: this.filter.threshold,
      timeoutMs: this.filter.timeout,
      testing: this.testing,
      nextTestAt: this.nextTestAt,
      reviews,
      lastTest: tests[0]
        ? { ...tests[0], success: tests[0].confidence !== null }
        : null,
      counts: {
        reviewed: reviews.length,
        approved: reviews.filter((r) => r.outcome === "approved").length,
        vetoed: reviews.filter((r) => r.outcome === "vetoed").length,
        errors: reviews.filter((r) => r.outcome === "error").length,
      },
    };
  }

  async testConnection() {
    if (!this.filter.enabled)
      return {
        status: 409,
        error: "Enable AI in backend .env and restart the backend first.",
      };
    if (this.testing || this.now() < this.nextTestAt)
      return {
        status: 429,
        error: "Wait 30 seconds between connection tests.",
      };
    this.testing = true;
    this.nextTestAt = this.now() + 30000;
    try {
      const decision = await this.filter.evaluate({
        purpose:
          "Connection test only; insufficient market data, reject this entry",
        signal: "BUY",
        candles: [],
      });
      const row = {
        at: this.now(),
        provider: this.filter.provider,
        model: this.filter.model,
        ...decision,
      };
      store.appendLine(
        path.join(this.dataDir, "ai_connection_tests.jsonl"),
        row,
      );
      return {
        status: 200,
        success: Number.isFinite(decision.confidence),
        ...decision,
      };
    } finally {
      this.testing = false;
    }
  }
}
module.exports = { AIMonitor, recentReviews };
