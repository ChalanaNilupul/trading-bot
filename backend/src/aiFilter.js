/** Optional entry veto. Never controls exits, sizing, stops, or leverage. */
const REVIEW_PROMPT = "Review a proposed paper-trading entry using only supplied closed-candle data. Veto unclear, weak or conflicting setups. You cannot predict profit. Confidence is a subjective assessment, not a calibrated win probability. Return approve, confidence (0..1), and a brief reason. Never propose orders, sizing, leverage or changes to exits.";
const REVIEW_SCHEMA = {
    type: "object", additionalProperties: false,
    properties: { approve: { type: "boolean" }, confidence: { type: "number" }, reason: { type: "string" } },
    required: ["approve", "confidence", "reason"],
};

class AIEntryFilter {
    constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
        this.enabled = env.AI_ENABLED === "1";
        this.provider = (env.AI_PROVIDER || "openai").trim().toLowerCase();
        if (!["openai", "gemini"].includes(this.provider)) throw new Error("AI_PROVIDER must be openai or gemini");
        this.key = this.provider === "gemini" ? env.GEMINI_API_KEY : env.OPENAI_API_KEY;
        this.model = env.AI_MODEL;
        this.fetch = fetchImpl;
        this.timeout = Number(env.AI_TIMEOUT_MS || 8000);
        this.threshold = Number(env.AI_MIN_CONFIDENCE || 0.75);
        const keyName = this.provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
        if (this.enabled && (!this.key?.trim() || !this.model?.trim())) throw new Error(`AI_ENABLED requires ${keyName} and AI_MODEL`);
        if (!(this.timeout >= 100 && this.timeout <= 30000)) throw new Error("AI_TIMEOUT_MS must be 100..30000");
        if (!(this.threshold >= 0 && this.threshold <= 1)) throw new Error("AI_MIN_CONFIDENCE must be 0..1");
    }

    request(snapshot) {
        if (this.provider === "gemini") {
            return {
                url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
                headers: { "x-goog-api-key": this.key, "Content-Type": "application/json" },
                body: {
                    systemInstruction: { parts: [{ text: REVIEW_PROMPT }] },
                    contents: [{ role: "user", parts: [{ text: JSON.stringify(snapshot) }] }],
                    generationConfig: {
                        maxOutputTokens: 2048,
                        responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: REVIEW_SCHEMA } },
                    },
                },
            };
        }
        return {
            url: "https://api.openai.com/v1/chat/completions",
            headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
            body: {
                model: this.model, store: false, max_completion_tokens: 500,
                messages: [
                    { role: "system", content: REVIEW_PROMPT },
                    { role: "user", content: JSON.stringify(snapshot) },
                ],
                response_format: { type: "json_schema", json_schema: {
                    name: "entry_review", strict: true, schema: REVIEW_SCHEMA,
                } },
            },
        };
    }

    reviewText(body) {
        if (this.provider === "gemini") {
            const candidate = body.candidates?.[0];
            if (body.promptFeedback?.blockReason || candidate?.finishReason !== "STOP" || candidate.safetyRatings?.some(rating => rating.blocked)) throw new Error("Incomplete review");
            const parts = candidate.content?.parts;
            if (!Array.isArray(parts)) throw new Error("Missing review");
            // Thought summaries are separate from the final structured response.
            return parts.filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("");
        }
        const choice = body.choices?.[0];
        if (choice?.finish_reason !== "stop" || choice.message?.refusal) throw new Error("Incomplete review");
        return choice.message.content;
    }

    async evaluate(snapshot) {
        if (!this.enabled) return { allowed: true, reason: "AI disabled" };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
            const request = this.request(snapshot);
            const response = await this.fetch(request.url, {
                method: "POST", signal: controller.signal,
                headers: request.headers, body: JSON.stringify(request.body),
            });
            if (!response.ok) return { allowed: false, reason: `AI HTTP ${response.status}` };
            const review = JSON.parse(this.reviewText(await response.json()));
            if (!review || typeof review.approve !== "boolean" || !Number.isFinite(review.confidence) || review.confidence < 0 || review.confidence > 1 || typeof review.reason !== "string" || review.reason.length > 1000) throw new Error("Invalid review");
            return { allowed: review.approve && review.confidence >= this.threshold, confidence: review.confidence, reason: review.reason.slice(0, 300) };
        } catch {
            // Do not log provider bodies/errors: they can include sensitive request details.
            return { allowed: false, reason: "AI unavailable or invalid response" };
        } finally { clearTimeout(timer); }
    }
}
module.exports = { AIEntryFilter };
