// Quick checks for js/data.js and js/review.js. Run: node scripts/test-review.mjs
import assert from 'node:assert/strict';
import { SAMPLES, COMPLAINTS, DEMO_RESULTS } from '../js/data.js';
import { reviewPhoto, validateReview, extractJson, ReviewError, DemoUnavailableError } from '../js/review.js';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.log(`FAIL ${name}\n     ${err.message}`); process.exitCode = 1; }
}

const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' };
const text = (id) => COMPLAINTS.find((c) => c.id === id).text;
const expected = {
  'gate2-day|single': 'needs_photo', 'gate2-day|row': 'needs_photo',
  'gate2-night|single': 'ready', 'gate2-night|row': 'needs_photo',
  'gate3-night|single': 'needs_photo', 'gate3-night|row': 'needs_photo',
};

await test('data shapes', () => {
  assert.deepEqual(SAMPLES.map((s) => s.id), ['gate2-day', 'gate2-night', 'gate3-night']);
  assert.ok(SAMPLES.every((s) => s.file === `./samples/${s.id}.png` && s.label));
  assert.deepEqual(COMPLAINTS.map((c) => c.id), ['single', 'row']);
  assert.deepEqual(Object.keys(DEMO_RESULTS).sort(), Object.keys(expected).sort());
});

for (const [key, status] of Object.entries(expected)) {
  await test(`demo ${key} -> ${status}`, async () => {
    const [sampleId, complaintId] = key.split('|');
    const r = await reviewPhoto({ complaint: `  ${text(complaintId)} `, image, sampleId, mode: 'demo' });
    assert.equal(r.status, status);
    assert.deepEqual(validateReview(r), r);
  });
}

await test('demo: custom text -> DemoUnavailableError', () =>
  assert.rejects(reviewPhoto({ complaint: 'Lamp near the park is broken.', image, sampleId: 'gate2-night', mode: 'demo' }), DemoUnavailableError));
await test('demo: sampleId null -> DemoUnavailableError', () =>
  assert.rejects(reviewPhoto({ complaint: text('single'), image, sampleId: null, mode: 'demo' }), DemoUnavailableError));
await test('DemoUnavailableError is a ReviewError', () => assert.ok(new DemoUnavailableError() instanceof ReviewError));

await test('validate: accepts and coerces', () => {
  assert.deepEqual(validateReview({ status: ' Ready ', observation: ' Lit lamp. ', next_photo_request: '' }),
    { status: 'ready', observation: 'Lit lamp.', next_photo_request: null });
  assert.equal(validateReview({ status: 'ready', observation: 'x', next_photo_request: 'null' }).next_photo_request, null);
});
for (const [why, bad] of [
  ['null', null], ['array', []], ['bad status', { status: 'closed', observation: 'x', next_photo_request: null }],
  ['empty observation', { status: 'ready', observation: '  ', next_photo_request: null }],
  ['ready with request', { status: 'ready', observation: 'x', next_photo_request: 'Take another.' }],
  ['needs_photo without request', { status: 'needs_photo', observation: 'x', next_photo_request: null }],
  ['non-string request', { status: 'needs_photo', observation: 'x', next_photo_request: 5 }],
]) await test(`validate rejects: ${why}`, () => assert.throws(() => validateReview(bad), ReviewError));

await test('extractJson tolerates fences, rejects garbage', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json'), ReviewError);
  assert.throws(() => extractJson('{bad}'), ReviewError);
});

// Live path with a mocked fetch.
const live = (provider, fetchImpl) => {
  globalThis.fetch = fetchImpl;
  return reviewPhoto({ complaint: text('single'), image, sampleId: null, mode: 'live', provider, apiKey: 'sk-test' });
};
const ok = (body) => async () => new Response(JSON.stringify(body), { status: 200 });
const answer = JSON.stringify({ status: 'ready', observation: 'Lamp on beside GATE 2 sign at night.', next_photo_request: null });

await test('live claude: request shape + parse', async () => {
  let seen;
  const r = await live('claude', async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: answer }] }));
  });
  assert.equal(r.status, 'ready');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.body.model, 'claude-haiku-5-5');
  assert.equal(seen.body.messages[0].content[0].source.data, 'iVBORw0KGgo=');
});
await test('live gemini: request shape + parse', async () => {
  let seen;
  const r = await live('gemini', async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
  });
  assert.equal(r.status, 'ready');
  assert.match(seen.url, /\/v1beta\/models\/gemini-[\w.-]+:generateContent$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'sk-test');
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
});
for (const [status, msg] of [[401, 'API key rejected.'], [403, 'API key rejected.'], [429, 'Rate limited, try again shortly.']]) {
  await test(`live HTTP ${status} -> "${msg}"`, () =>
    assert.rejects(live('claude', async () => new Response('{}', { status })), (e) => e instanceof ReviewError && e.message === msg));
}
await test('live gemini 400 API_KEY_INVALID -> key rejected', () =>
  assert.rejects(live('gemini', async () => new Response('{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}', { status: 400 })),
    (e) => e.message === 'API key rejected.'));
await test('live network error -> user-safe ReviewError without key', () =>
  assert.rejects(live('claude', async () => { throw new TypeError('Failed to fetch'); }),
    (e) => e instanceof ReviewError && !e.message.includes('sk-test')));
await test('live invalid model JSON -> ReviewError', () =>
  assert.rejects(live('claude', ok({ content: [{ type: 'text', text: '{"status":"maybe","observation":"x"}' }] })), ReviewError));
await test('live caller abort -> AbortError passes through', async () => {
  const ctrl = new AbortController();
  globalThis.fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const p = reviewPhoto({ complaint: text('single'), image, mode: 'live', provider: 'claude', apiKey: 'k', signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
