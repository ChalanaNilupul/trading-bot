/** Optional entry veto. Never controls exits, sizing, stops, or leverage. */
class AIEntryFilter {
    constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
        this.enabled = env.AI_ENABLED === "1";
        this.key = env.OPENAI_API_KEY;
        this.model = env.AI_MODEL;
        this.fetch = fetchImpl;
        this.timeout = Number(env.AI_TIMEOUT_MS || 8000);
        this.threshold = Number(env.AI_MIN_CONFIDENCE || 0.75);
        if (this.enabled && (!this.key || !this.model)) throw new Error("AI_ENABLED requires OPENAI_API_KEY and AI_MODEL");
        if (!(this.timeout >= 100 && this.timeout <= 30000)) throw new Error("AI_TIMEOUT_MS must be 100..30000");
        if (!(this.threshold >= 0 && this.threshold <= 1)) throw new Error("AI_MIN_CONFIDENCE must be 0..1");
    }

    async evaluate(snapshot) {
        if (!this.enabled) return { allowed: true, reason: "AI disabled" };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await this.fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", signal: controller.signal,
                headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: this.model, store: false, max_completion_tokens: 500,
                    messages: [
                        { role: "system", content: "Review a proposed paper-trading entry using only supplied closed-candle data. Veto unclear, weak or conflicting setups. You cannot predict profit. Confidence is a subjective assessment, not a calibrated win probability. Return approve, confidence (0..1), and a brief reason. Never propose orders, sizing, leverage or changes to exits." },
                        { role: "user", content: JSON.stringify(snapshot) },
                    ],
                    response_format: { type: "json_schema", json_schema: {
                        name: "entry_review", strict: true,
                        schema: { type: "object", additionalProperties: false,
                            properties: { approve: { type: "boolean" }, confidence: { type: "number" }, reason: { type: "string" } },
                            required: ["approve", "confidence", "reason"] },
                    } },
                }),
            });
            if (!response.ok) return { allowed: false, reason: `AI HTTP ${response.status}` };
            const body = await response.json();
            const choice = body.choices?.[0];
            if (choice?.finish_reason !== "stop" || choice.message?.refusal) throw new Error("Incomplete review");
            const review = JSON.parse(choice.message.content);
            if (typeof review.approve !== "boolean" || !Number.isFinite(review.confidence) || review.confidence < 0 || review.confidence > 1 || typeof review.reason !== "string" || review.reason.length > 1000) throw new Error("Invalid review");
            return { allowed: review.approve && review.confidence >= this.threshold, confidence: review.confidence, reason: review.reason.slice(0, 300) };
        } catch {
            // Do not log provider bodies/errors: they can include sensitive request details.
            return { allowed: false, reason: "AI unavailable or invalid response" };
        } finally { clearTimeout(timer); }
    }
}
module.exports = { AIEntryFilter };
