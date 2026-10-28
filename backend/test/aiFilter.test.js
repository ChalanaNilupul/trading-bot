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
