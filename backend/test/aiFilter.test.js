const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIEntryFilter } = require('../src/aiFilter');
const { FuturesEngine } = require('../src/futuresEngine');
const env = { AI_ENABLED: '1', OPENAI_API_KEY: 'test-secret', AI_MODEL: 'test-model' };
const response = value => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }) });
test('disabled filter never calls provider', async () => {
    const filter = new AIEntryFilter({ env: {}, fetchImpl: () => { throw Error('unexpected'); } });
    assert.equal((await filter.evaluate({})).allowed, true);
});
test('enabled filter requires credentials and model', () => {
    assert.throws(() => new AIEntryFilter({ env: { AI_ENABLED: '1' } }));
});
test('approval requires valid confidence and explicit approval', async () => {
    for (const [review, expected] of [
        [{ approve: true, confidence: 0.8, reason: 'trend' }, true],
        [{ approve: false, confidence: 0.9, reason: 'chop' }, false],
        [{ approve: true, confidence: 0.5, reason: 'weak' }, false],
        [{ approve: 'true', confidence: 0.9, reason: 'invalid' }, false],
        [{ approve: true, confidence: 2, reason: 'invalid' }, false],
    ]) {
        const filter = new AIEntryFilter({ env, fetchImpl: async (_, options) => {
            assert.equal(options.headers.Authorization, 'Bearer test-secret');
            assert.equal(JSON.parse(options.body).store, false);
            return response(review);
        } });
        assert.equal((await filter.evaluate({})).allowed, expected);
    }
});
test('HTTP errors, malformed output, refusals and timeout veto entries', async () => {
    for (const fetchImpl of [
        async () => ({ ok: false, status: 429 }),
        async () => { throw Error('network secret'); },
        async () => ({ ok: true, json: async () => ({ choices: [] }) }),
        async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }) }),
        (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))),
    ]) {
        const result = await new AIEntryFilter({ env: { ...env, AI_TIMEOUT_MS: '100' }, fetchImpl }).evaluate({});
        assert.equal(result.allowed, false);
        assert.ok(!result.reason.includes('secret'));
    }
});
test('veto blocks entries but cannot block a short position exit', () => {
    const engine = new FuturesEngine({ allowShort: true, feeRate: 0, slippage: 0 });
    const candle = { open: 100, high: 100, low: 100, close: 100, openTime: 1, closeTime: 2 };
    const execute = { immediate: true, executionPrice: 100, executionTime: 3 };
    const analysis = { signal: 'BUY', indicators: { atr14: 2 }, entryAllowed: false };
    engine.onCandle(candle, analysis, execute);
    assert.equal(engine.position, null);
    engine.onCandle(candle, { ...analysis, signal: 'SHORT', entryAllowed: true }, execute);
    assert.equal(engine.position.side, 'SHORT');
    engine.onCandle(candle, analysis, execute);
    assert.equal(engine.position, null);
    assert.equal(engine.trades[0].reason, 'SIGNAL');
});

const geminiEnv = { AI_ENABLED: '1', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-secret', AI_MODEL: 'test-gemini' };
const geminiBody = review => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(review) }] } }] });
const jsonResponse = body => ({ ok: true, json: async () => body });
test('Gemini uses only its key, official endpoint, schema and supplied snapshot', async () => {
    const snapshot = { signal: 'BUY', symbol: 'BTCUSDT', candles: [] };
    const filter = new AIEntryFilter({ env: { ...geminiEnv, OPENAI_API_KEY: 'unused-secret' }, fetchImpl: async (url, options) => {
        assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-gemini:generateContent');
        assert.ok(!url.includes('secret'));
        assert.equal(options.headers['x-goog-api-key'], 'gemini-secret');
        assert.equal(options.headers.Authorization, undefined);
        assert.ok(!options.body.includes('secret'));
        const request = JSON.parse(options.body);
        assert.deepEqual(JSON.parse(request.contents[0].parts[0].text), snapshot);
        assert.equal(request.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
        assert.deepEqual(request.generationConfig.responseFormat.text.schema.required, ['approve', 'confidence', 'reason']);
        assert.ok(request.systemInstruction.parts[0].text.includes('paper-trading'));
        return jsonResponse(geminiBody({ approve: true, confidence: 0.9, reason: 'trend' }));
    } });
    assert.equal((await filter.evaluate(snapshot)).allowed, true);
});
test('provider selection validates configuration without falling back to another key', () => {
    assert.equal(new AIEntryFilter({ env }).provider, 'openai');
    assert.equal(new AIEntryFilter({ env: geminiEnv }).provider, 'gemini');
    assert.throws(() => new AIEntryFilter({ env: { ...env, AI_PROVIDER: 'other' } }), /AI_PROVIDER/);
    assert.throws(() => new AIEntryFilter({ env: { ...env, AI_PROVIDER: 'gemini' } }), /GEMINI_API_KEY/);
    assert.throws(() => new AIEntryFilter({ env: { ...geminiEnv, AI_MODEL: '' } }), /AI_MODEL/);
});
test('Gemini applies confidence/veto validation and ignores thought parts', async () => {
    for (const [review, expected] of [
        [{ approve: false, confidence: 0.9, reason: 'chop' }, false],
        [{ approve: true, confidence: 0.5, reason: 'weak' }, false],
        [{ approve: true, confidence: '0.9', reason: 'invalid' }, false],
        [null, false],
        [{ approve: true, confidence: 0.9, reason: 'trend' }, true],
    ]) {
        const body = geminiBody(review);
        body.candidates[0].content.parts.unshift({ thought: true, text: 'not final JSON' });
        const filter = new AIEntryFilter({ env: geminiEnv, fetchImpl: async () => jsonResponse(body) });
        assert.equal((await filter.evaluate({})).allowed, expected);
    }
});
test('Gemini blocked, truncated, empty, malformed, HTTP and timeout replies veto without fallback', async () => {
    const valid = { approve: true, confidence: 0.9, reason: 'trend' };
    for (const body of [
        { promptFeedback: { blockReason: 'SAFETY' }, ...geminiBody(valid) },
        { candidates: [{ ...geminiBody(valid).candidates[0], finishReason: 'MAX_TOKENS' }] },
        { candidates: [{ ...geminiBody(valid).candidates[0], finishReason: 'SAFETY' }] },
        { candidates: [{ ...geminiBody(valid).candidates[0], safetyRatings: [{ blocked: true }] }] },
        { candidates: [] },
        { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
        { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{' }] } }] },
    ]) {
        assert.equal((await new AIEntryFilter({ env: geminiEnv, fetchImpl: async () => jsonResponse(body) }).evaluate({})).allowed, false);
    }
    for (const fetchImpl of [
        async () => ({ ok: false, status: 429 }),
        async () => { throw Error('gemini-secret'); },
        (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))),
    ]) {
        let calls = 0;
        const filter = new AIEntryFilter({ env: { ...geminiEnv, AI_TIMEOUT_MS: '100' }, fetchImpl: (...args) => { calls++; return fetchImpl(...args); } });
        const decision = await filter.evaluate({});
        assert.equal(decision.allowed, false);
        assert.ok(!decision.reason.includes('secret'));
        assert.equal(calls, 1);
    }
});
