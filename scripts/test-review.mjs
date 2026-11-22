// Offline checks for js/data.js and js/review.js (fetch is mocked). Run: node scripts/test-review.mjs
import assert from 'node:assert/strict';
import { SAMPLES, COMPLAINTS, CASES, DEMO_STEPS, DEMO_RESULTS } from '../js/data.js';
import {
  reviewPhoto, validateReview, extractJson, demoKey, ReviewError, DemoUnavailableError,
  STATUS_LABELS, GEMINI_MODELS, RESPONSE_SCHEMA,
} from '../js/review.js';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.log(`FAIL ${name}\n     ${err.stack?.split('\n').slice(0, 3).join('\n     ')}`); process.exitCode = 1; }
}

const image = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', mimeType: 'image/jpeg' };
const EXPECTED = {
  'gate2-day|single': 'needs_photo', 'gate2-day|row': 'needs_photo',
  'gate2-night|single': 'ready', 'gate2-night|row': 'needs_photo',
  'gate3-night|single': 'needs_photo', 'gate3-night|row': 'needs_photo',
  'row-partial|single': 'ready', 'row-partial|row': 'not_fixed',
  'row-full|single': 'ready', 'row-full|row': 'ready',
};
const goodChecks = [
  { label: 'Location', expected: 'Lamp beside Gate 2', seen: 'Sign reads GATE 2', result: 'pass' },
  { label: 'Lamp state', expected: 'Lamp on', seen: 'Lamp lit', result: 'pass' },
];

// ---------- data ----------
await test('data: samples, complaints, cases, steps', () => {
  assert.deepEqual(Object.keys(SAMPLES), ['gate2-day', 'gate2-night', 'gate3-night', 'row-partial', 'row-full']);
  for (const [id, s] of Object.entries(SAMPLES)) {
    assert.equal(s.file, `./samples/${id}.jpg`); assert.equal(s.mimeType, 'image/jpeg'); assert.ok(s.label);
  }
  assert.deepEqual(Object.keys(COMPLAINTS), ['single', 'row']);
  assert.equal(COMPLAINTS.single, 'The streetlight beside Gate 2 stays dark at night.');
  assert.equal(COMPLAINTS.row, 'The entire row of lights by Gate 2 stays dark.');
  assert.deepEqual(CASES.map((c) => c.id), ['SL-1042', 'SL-1043', 'SL-1047']);
  for (const c of CASES) {
    for (const f of ['title', 'location', 'reportedBy', 'reportedAt', 'crewNote']) assert.ok(c[f], `${c.id}.${f}`);
    assert.ok(COMPLAINTS[c.complaintId]); assert.ok(c.photos.every((p) => SAMPLES[p]));
    assert.ok(!Number.isNaN(Date.parse(c.reportedAt)));
  }
  assert.equal(DEMO_STEPS.length, 5);
  for (const s of DEMO_STEPS) {
    const c = CASES.find((x) => x.id === s.caseId);
    assert.ok(c && c.photos.includes(s.photoId) && s.say, JSON.stringify(s));
  }
  assert.deepEqual(Object.keys(DEMO_RESULTS).sort(), Object.keys(EXPECTED).sort());
  assert.deepEqual(Object.keys(STATUS_LABELS), ['ready', 'needs_photo', 'not_fixed']);
});

await test('data: every demo result is a valid Review matching the expected table', () => {
  for (const [key, r] of Object.entries(DEMO_RESULTS)) {
    assert.equal(r.status, EXPECTED[key], key);
    assert.equal(r.model, 'Demo data', key);
    const { model, ...rest } = r;
    assert.deepEqual(validateReview(rest), rest, key);
    if (r.status === 'ready') assert.ok(r.checks.every((c) => c.result === 'pass'), `${key} ready needs all pass`);
    else assert.ok(r.checks.some((c) => c.result !== 'pass'), `${key} needs a non-pass check`);
  }
});

// ---------- demo mode ----------
for (const [key, status] of Object.entries(EXPECTED)) {
  await test(`demo ${key} -> ${status}`, async () => {
    const [photoId, complaintId] = key.split('|');
    const r = await reviewPhoto({ complaint: `  ${COMPLAINTS[complaintId]}\n`, image: null, photoId, mode: 'demo' });
    assert.equal(r.status, status);
    assert.equal(r.model, 'Demo data');
    r.checks[0].seen = 'mutated';
    assert.notEqual(DEMO_RESULTS[key].checks[0].seen, 'mutated', 'demo result must be a copy');
  });
}
await test('demo: custom complaint -> DemoUnavailableError', () =>
  assert.rejects(reviewPhoto({ complaint: 'Lamp near the park is broken.', photoId: 'gate2-night', mode: 'demo' }), DemoUnavailableError));
await test('demo: photoId null / unknown -> DemoUnavailableError', async () => {
  await assert.rejects(reviewPhoto({ complaint: COMPLAINTS.single, photoId: null, mode: 'demo' }), DemoUnavailableError);
  await assert.rejects(reviewPhoto({ complaint: COMPLAINTS.single, photoId: 'toString', mode: 'demo' }), DemoUnavailableError);
});
await test('demo: demoKey', () => {
  assert.equal(demoKey('row-full', ' ' + COMPLAINTS.row), 'row-full|row');
  assert.equal(demoKey('row-full', 'other'), null);
});
await test('demo: abort during delay -> AbortError', async () => {
  const ctrl = new AbortController();
  const p = reviewPhoto({ complaint: COMPLAINTS.single, photoId: 'gate2-day', mode: 'demo', signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError');
});
await test('DemoUnavailableError is a ReviewError', () => assert.ok(new DemoUnavailableError() instanceof ReviewError));

// ---------- validation ----------
await test('validate: accepts and normalises', () => {
  const r = validateReview({ status: ' Ready ', observation: ' Lit lamp. ', checks: goodChecks.map((c) => ({ ...c, result: ' PASS ' })), next_photo_request: '' });
  assert.equal(r.status, 'ready'); assert.equal(r.observation, 'Lit lamp.'); assert.equal(r.next_photo_request, null);
  assert.equal(r.checks[0].result, 'pass');
  assert.equal(validateReview({ status: 'ready', observation: 'x', checks: goodChecks, next_photo_request: 'none' }).next_photo_request, null);
  assert.equal(validateReview({ status: 'not_fixed', observation: 'x', checks: goodChecks, next_photo_request: 'Fix lamp 4.' }).status, 'not_fixed');
});
const base = { status: 'needs_photo', observation: 'x', checks: goodChecks, next_photo_request: 'Take a night photo.' };
for (const [why, bad] of [
  ['null', null], ['array', []],
  ['bad status', { ...base, status: 'closed' }],
  ['empty observation', { ...base, observation: '  ' }],
  ['no checks', { ...base, checks: undefined }],
  ['1 check', { ...base, checks: goodChecks.slice(0, 1) }],
  ['6 checks', { ...base, checks: [...goodChecks, ...goodChecks, ...goodChecks] }],
  ['check empty label', { ...base, checks: [goodChecks[0], { ...goodChecks[1], label: ' ' }] }],
  ['check empty seen', { ...base, checks: [goodChecks[0], { ...goodChecks[1], seen: '' }] }],
  ['check bad result', { ...base, checks: [goodChecks[0], { ...goodChecks[1], result: 'maybe' }] }],
  ['check not object', { ...base, checks: [goodChecks[0], 'x'] }],
  ['ready with request', { ...base, status: 'ready', next_photo_request: 'Take another.' }],
  ['ready with failed check', { ...base, status: 'ready', checks: [goodChecks[0], { ...goodChecks[1], result: 'fail' }], next_photo_request: '' }],
  ['ready with unclear check', { ...base, status: 'ready', checks: [goodChecks[0], { ...goodChecks[1], result: 'unclear' }], next_photo_request: '' }],
  ['needs_photo without request', { ...base, next_photo_request: '' }],
  ['not_fixed without request', { ...base, status: 'not_fixed', next_photo_request: null }],
  ['non-string request', { ...base, next_photo_request: 5 }],
]) await test(`validate rejects: ${why}`, () => assert.throws(() => validateReview(bad), ReviewError));

await test('extractJson tolerates fences, rejects garbage', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json'), ReviewError);
  assert.throws(() => extractJson('{bad}'), ReviewError);
});
await test('schema: simple (no anyOf), status enum of three', () => {
  assert.ok(!JSON.stringify(RESPONSE_SCHEMA).includes('anyOf'));
  assert.deepEqual(RESPONSE_SCHEMA.properties.status.enum, ['ready', 'needs_photo', 'not_fixed']);
  assert.equal(RESPONSE_SCHEMA.properties.next_photo_request.type, 'string');
});

// ---------- live, mocked fetch ----------
const answerObj = { checks: goodChecks, observation: 'Lamp on beside GATE 2 sign at night.', status: 'ready', next_photo_request: '' };
const answer = JSON.stringify(answerObj);
const geminiOk = (text = answer, modelVersion) => new Response(JSON.stringify({ modelVersion, candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text }] } }] }));
const json = (status, body = {}) => new Response(JSON.stringify(body), { status });
const modelOf = (url) => url.match(/models\/([^:]+):/)?.[1];
const live = (provider, fetchImpl, extra = {}) => {
  globalThis.fetch = fetchImpl;
  return reviewPhoto({ complaint: COMPLAINTS.single, image, photoId: null, mode: 'live', provider, apiKey: 'sk-test', ...extra });
};

await test('live claude: request shape + parse + model label', async () => {
  let seen;
  const r = await live('claude', async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: answer }] }));
  });
  assert.equal(r.status, 'ready'); assert.equal(r.model, 'Claude Haiku 5.5'); assert.equal(r.next_photo_request, null);
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.init.headers['x-api-key'], 'sk-test');
  assert.equal(seen.body.model, 'claude-haiku-5-5');
  assert.equal(seen.body.output_config.format.type, 'json_schema');
  assert.equal(seen.body.messages[0].content[0].source.data, '/9j/4AAQ');
});
await test('live gemini: request shape + first model + label', async () => {
  let seen;
  const r = await live('gemini', async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return geminiOk(); });
  assert.equal(r.status, 'ready'); assert.equal(r.model, 'Gemini 3.8 Flash');
  assert.equal(modelOf(seen.url), 'gemini-3.8-flash');
  assert.equal(seen.init.headers['x-goog-api-key'], 'sk-test');
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(seen.body.generationConfig.responseJsonSchema);
  assert.equal(seen.body.contents[0].parts[0].inlineData.data, '/9j/4AAQ');
});
await test('live gemini: the returned model version overrides the requested label', async () => {
  const r = await live('gemini', async () => geminiOk(answer, 'gemini-3.8-flash-002'));
  assert.equal(r.model, 'gemini-3.8-flash-002');
});
await test('gemini chain: 503 -> next model, with onStatus', async () => {
  const calls = []; const statuses = [];
  const r = await live('gemini', async (url) => {
    calls.push(modelOf(url));
    return calls.length <= 2 ? json(503, { error: { message: 'high demand' } }) : geminiOk();
  }, { onStatus: (t) => statuses.push(t) });
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
  assert.equal(r.model, 'Gemini 3.6 Flash');
  assert.deepEqual(statuses, ['Gemini 3.8 Flash is busy, trying Gemini 3.7 Flash…', 'Gemini 3.7 Flash is busy, trying Gemini 3.6 Flash…']);
});
await test('gemini chain: 500/429/404 also fall back; ends on Flash-Lite', async () => {
  const codes = [500, 429, 404, 503]; const calls = [];
  const r = await live('gemini', async (url) => { calls.push(modelOf(url)); const c = codes[calls.length - 1]; return c ? json(c) : geminiOk(); });
  assert.deepEqual(calls, GEMINI_MODELS.map((m) => m.id));
  assert.equal(r.model, 'Gemini 3.1 Flash-Lite');
});
await test('gemini chain: all busy -> ReviewError', async () => {
  let n = 0;
  await assert.rejects(live('gemini', async () => { n++; return json(503); }), (e) => e instanceof ReviewError && /busy/.test(e.message));
  assert.equal(n, 5);
});
await test('gemini chain: all rate limited -> rate-limit message', () =>
  assert.rejects(live('gemini', async () => json(429)), (e) => e.message === 'Rate limited, try again shortly.'));
for (const [status, body] of [[401, {}], [403, {}], [400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }]]) {
  await test(`gemini ${status}${status === 400 ? ' API_KEY_INVALID' : ''} -> "API key rejected.", no fallback`, async () => {
    let n = 0; const statuses = [];
    await assert.rejects(live('gemini', async () => { n++; return json(status, body); }, { onStatus: (t) => statuses.push(t) }),
      (e) => e instanceof ReviewError && e.message === 'API key rejected.');
    assert.equal(n, 1); assert.deepEqual(statuses, []);
  });
}
await test('gemini plain 400 -> no fallback', async () => {
  let n = 0;
  await assert.rejects(live('gemini', async () => { n++; return json(400, { error: { message: 'bad' } }); }), ReviewError);
  assert.equal(n, 1);
});
await test('gemini chain: per-attempt timeout -> next model', async () => {
  const calls = []; const statuses = [];
  const r = await live('gemini', (url, init) => {
    calls.push(modelOf(url));
    if (calls.length > 1) return Promise.resolve(geminiOk());
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  }, { timeoutMs: 50, onStatus: (t) => statuses.push(t) });
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.7-flash']);
  assert.equal(r.model, 'Gemini 3.7 Flash');
  assert.deepEqual(statuses, ['Gemini 3.8 Flash is busy, trying Gemini 3.7 Flash…']);
});
await test('gemini: caller abort passes through unwrapped, no fallback', async () => {
  const ctrl = new AbortController(); let n = 0; const statuses = [];
  const p = live('gemini', (url, init) => { n++; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); },
    { signal: ctrl.signal, onStatus: (t) => statuses.push(t) });
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError' && !(e instanceof ReviewError));
  assert.equal(n, 1); assert.deepEqual(statuses, []);
});
await test('claude: caller abort passes through', async () => {
  const ctrl = new AbortController();
  const p = live('claude', (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});
await test('already-aborted signal -> AbortError without fetching', async () => {
  let n = 0;
  await assert.rejects(live('gemini', async () => { n++; return geminiOk(); }, { signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
  assert.equal(n, 0);
});
await test('claude 401 -> key rejected; network error is user-safe', async () => {
  await assert.rejects(live('claude', async () => json(401)), (e) => e.message === 'API key rejected.');
  await assert.rejects(live('claude', async () => { throw new TypeError('Failed to fetch'); }),
    (e) => e instanceof ReviewError && !e.message.includes('sk-test'));
});
await test('live: invalid model JSON -> ReviewError (gemini does not fall back)', async () => {
  let n = 0;
  await assert.rejects(live('gemini', async () => { n++; return geminiOk('{"status":"maybe","observation":"x"}'); }), ReviewError);
  assert.equal(n, 1);
});
await test('live: not_fixed answer round-trips', async () => {
  const r = await live('gemini', async () => geminiOk(JSON.stringify({ ...answerObj, status: 'not_fixed', next_photo_request: 'Repair the two dark lamps.' })));
  assert.equal(r.status, 'not_fixed'); assert.equal(r.next_photo_request, 'Repair the two dark lamps.');
});
await test('live: missing key / image -> ReviewError', async () => {
  await assert.rejects(live('gemini', async () => geminiOk(), { apiKey: ' ' }), (e) => e.message === 'Add an API key to use Live mode.');
  await assert.rejects(live('gemini', async () => geminiOk(), { image: null }), ReviewError);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
