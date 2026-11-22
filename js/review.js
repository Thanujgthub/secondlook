// SecondLook review logic: Demo lookups and live vision-model reviews (Gemini with a model fallback chain, or Claude).
// Review = { status: 'ready'|'needs_photo'|'not_fixed', observation, checks: [{label, expected, seen, result}],
//            next_photo_request: string|null, model: string }
import { COMPLAINTS, SAMPLES, DEMO_RESULTS } from './data.js';

export class ReviewError extends Error {
  constructor(message) { super(message); this.name = 'ReviewError'; }
}
export class DemoUnavailableError extends ReviewError {
  constructor(message = 'Demo mode covers the sample photos and preset complaints. Switch to Live and add an API key to review your own.') {
    super(message); this.name = 'DemoUnavailableError';
  }
}

export const STATUS_LABELS = { ready: 'Ready for sign-off', needs_photo: 'Needs a better photo', not_fixed: 'Repair incomplete' };
export const STATUSES = Object.keys(STATUS_LABELS);
export const CHECK_RESULTS = ['pass', 'fail', 'unclear'];

export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const CLAUDE_LABEL = 'Claude Haiku 5.5';
export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
];
export const ATTEMPT_TIMEOUT_MS = 25_000;
const DEMO_DELAY_MS = 900;
const FALLBACK_HTTP = new Set([404, 429, 500, 503]);

export const SYSTEM_PROMPT = `You are SecondLook, a strict evidence checker for streetlight repair complaints. A field crew has marked a complaint "fixed" and attached one photo. A ward supervisor will make the final decision; you only report whether the photo, on its own, proves the complaint is resolved. You never close a case.

## Step 1: split the complaint into checkable claims
Turn the complaint into 2 to 5 checks. Use these labels when they apply:
- "Location": the place or landmark named (for example "Lamp beside Gate 2"). It passes only if a sign or marking in the photo is clearly readable and matches exactly. A different gate number, an unreadable sign or no sign is not a match.
- "Time of day": a complaint about lights being dark needs a photo taken after dark. A daytime or dusk-bright photo fails this check, because it cannot show that a lamp works at night.
- "Coverage": only when the complaint covers more than one light (a row, a stretch, "all the lights"). It passes only if the whole group is in frame. One lamp, or part of a row, does not show the rest.
- "Lamp state": the lamp(s) named in the complaint are visibly switched on (a glowing lamp head and light falling on the ground). When several poles are in frame, go through them one by one from left to right and note for each whether its own lamp head (at the end of its arm) glows or is dark, then say how many are lit and how many are dark. For a single-lamp complaint, the lamp in question is the one on the pole standing closest to the named sign; say which pole that is (for example "2nd pole from the left, just left of the sign") and judge that lamp.

Each check has: "label"; "expected" (what the complaint needs, short); "seen" (what the photo actually shows, citing concrete details such as the exact sign text, sky brightness, how many poles and how many are lit); and "result":
- "pass": the photo clearly shows the claim is satisfied.
- "fail": the photo clearly shows the claim is NOT satisfied (wrong sign text, daytime, part of the row only, a lamp that should be on is dark at night).
- "unclear": the photo cannot tell (out of frame, too dark to read, off in daylight).

## Step 2: judge only from visible evidence
Describe only what is in the frame. Never assume anything outside it, never trust the crew's note, and never give the benefit of the doubt. Lamps that are not part of the complaint do not matter: for a complaint about the one lamp beside a landmark, other dark lamps further away do not fail it, but mention them in the observation.

## Step 3: decide the status
- "ready": every check passes. The photo, taken after dark at the named landmark, shows every light the complaint covers switched on.
- "not_fixed": the photo positively shows the problem is still there: it is at the right place (matching sign), after dark, and at least one lamp the complaint covers is clearly dark. Use it only for that positive evidence, never for a wrong place, a daytime photo or lamps that are simply out of frame.
- "needs_photo": anything else: wrong or unreadable location, daytime, part of the row missing from frame, blurry or ambiguous. When in doubt between "ready" and "needs_photo", choose "needs_photo".

## Output (JSON only)
- "checks": the 2 to 5 checks from Step 1.
- "observation": one sentence that cites the visible details behind the decision (time of day, sign text, number of lamps lit and dark).
- "status": "ready", "needs_photo" or "not_fixed".
- "next_photo_request": a concrete instruction for the field crew. For "needs_photo", say exactly what photo to take next: when (after dark), where (the named landmark with its sign readable in frame), what must be lit and how wide the shot must be. For "not_fixed", say what still needs repair (which or how many lamps are dark) and that a new night photo is needed after the repair. For "ready", use an empty string "".`;

// One response schema for both providers: plain strings and enums, no anyOf or length constraints
// (validated in code). Checks come first so the model reasons before it picks a status.
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          expected: { type: 'string' },
          seen: { type: 'string' },
          result: { type: 'string', enum: CHECK_RESULTS },
        },
        required: ['label', 'expected', 'seen', 'result'],
        additionalProperties: false,
      },
    },
    observation: { type: 'string' },
    status: { type: 'string', enum: STATUSES },
    next_photo_request: { type: 'string' },
  },
  required: ['checks', 'observation', 'status', 'next_photo_request'],
  additionalProperties: false,
};

// Validates a parsed model answer and returns a clean Review (without `model`), or throws ReviewError.
export function validateReview(raw) {
  const bad = (why) => new ReviewError(`The AI returned an unusable answer (${why}). Try again.`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('not an object');
  const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : '';
  if (!STATUSES.includes(status)) throw bad('unknown status');
  const observation = typeof raw.observation === 'string' ? raw.observation.trim() : '';
  if (!observation) throw bad('missing observation');

  if (!Array.isArray(raw.checks) || raw.checks.length < 2 || raw.checks.length > 5) throw bad('needs 2 to 5 checks');
  const checks = raw.checks.map((c) => {
    if (!c || typeof c !== 'object') throw bad('bad check');
    const out = {};
    for (const f of ['label', 'expected', 'seen']) {
      out[f] = typeof c[f] === 'string' ? c[f].trim() : '';
      if (!out[f]) throw bad(`check missing ${f}`);
    }
    out.result = typeof c.result === 'string' ? c.result.trim().toLowerCase() : '';
    if (!CHECK_RESULTS.includes(out.result)) throw bad('bad check result');
    return out;
  });

  let request = raw.next_photo_request;
  if (request !== null && request !== undefined && typeof request !== 'string') throw bad('bad photo request');
  request = typeof request === 'string' ? request.trim() : '';
  if (/^(null|none|n\/a)?$/i.test(request)) request = null;
  if (status === 'ready' && request) throw bad('ready but still asks for a photo');
  if (status === 'ready' && checks.some((c) => c.result !== 'pass')) throw bad('ready with incomplete checks');
  if (status !== 'ready' && !request) throw bad('no next step for the crew');
  return { status, observation, checks, next_photo_request: request };
}

// Pulls a JSON object out of model text, tolerating code fences or stray prose.
export function extractJson(text) {
  const t = String(text ?? '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ReviewError('The AI did not return a review. Try again.');
  try { return JSON.parse(t.slice(start, end + 1)); }
  catch { throw new ReviewError('The AI returned malformed JSON. Try again.'); }
}

// Returns `${photoId}|${complaintId}` for a preset complaint and sample photo, else null.
export function demoKey(photoId, complaint) {
  const text = String(complaint ?? '').trim();
  const complaintId = Object.keys(COMPLAINTS).find((id) => COMPLAINTS[id] === text);
  return photoId && Object.hasOwn(SAMPLES, photoId) && complaintId ? `${photoId}|${complaintId}` : null;
}

const clone = (r) => ({ ...r, checks: r.checks.map((c) => ({ ...c })) });

export async function reviewPhoto({
  complaint, image, photoId = null, mode = 'demo', provider = 'gemini', apiKey, signal, onStatus,
  timeoutMs = ATTEMPT_TIMEOUT_MS, // undocumented: lets tests shorten the per-attempt timeout
} = {}) {
  throwIfAborted(signal);
  if (mode === 'demo') {
    const key = demoKey(photoId, complaint);
    const result = key && DEMO_RESULTS[key];
    if (!result) throw new DemoUnavailableError();
    await delay(DEMO_DELAY_MS, signal);
    return clone(result);
  }

  const text = String(complaint ?? '').trim();
  if (!text) throw new ReviewError('Enter the complaint text first.');
  const base64 = String(image?.dataUrl ?? '').split(',')[1];
  const mimeType = image?.mimeType;
  if (!base64 || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new ReviewError('Choose a JPG or PNG photo first.');
  const key = String(apiKey ?? '').trim();
  if (!key) throw new ReviewError('Add an API key to use Live mode.');

  const args = { complaint: text, base64, mimeType, apiKey: key, signal, timeoutMs };
  if (provider === 'gemini') return reviewWithGemini({ ...args, onStatus });
  if (provider === 'claude') {
    const data = await postJson(claudeRequest(args), signal, timeoutMs);
    return { ...validateReview(extractJson(claudeText(data))), model: CLAUDE_LABEL };
  }
  throw new ReviewError('Unknown AI provider.');
}

const userText = (complaint) => `Complaint: "${complaint}"\n\nThe crew marked this fixed and attached the photo above. Check the photo against the complaint.`;

async function reviewWithGemini({ complaint, base64, mimeType, apiKey, signal, onStatus, timeoutMs }) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: userText(complaint) }] }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA },
  };
  let lastError;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    try {
      const data = await postJson({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
        headers: { 'x-goog-api-key': apiKey },
        body,
      }, signal, timeoutMs);
      const servedId = typeof data?.modelVersion === 'string' ? data.modelVersion : model.id;
      const label = GEMINI_MODELS.find(({ id }) => id === servedId)?.label || servedId;
      return { ...validateReview(extractJson(geminiText(data))), model: label };
    } catch (err) {
      if (!(err instanceof HttpFailure) || !err.retryable) throw err instanceof HttpFailure ? new ReviewError(err.message) : err;
      lastError = err;
      const next = GEMINI_MODELS[i + 1];
      if (next) safeStatus(onStatus, `${model.label} is busy, trying ${next.label}…`);
    }
  }
  throw new ReviewError(lastError?.status === 429
    ? 'Rate limited, try again shortly.'
    : 'Every Gemini model is busy right now. Try again shortly, or switch to Demo.');
}

function geminiText(data) {
  if (data?.promptFeedback?.blockReason) throw new ReviewError('The AI declined to review this photo.');
  const cand = data?.candidates?.[0];
  if (cand?.finishReason === 'SAFETY') throw new ReviewError('The AI declined to review this photo.');
  if (cand?.finishReason === 'MAX_TOKENS') throw new ReviewError('The AI answer was cut off. Try again.');
  return (cand?.content?.parts ?? []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
}

function claudeRequest({ complaint, base64, mimeType, apiKey }) {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: userText(complaint) },
        ],
      }],
    },
  };
}

function claudeText(data) {
  if (data?.stop_reason === 'refusal') throw new ReviewError('The AI declined to review this photo.');
  if (data?.stop_reason === 'max_tokens') throw new ReviewError('The AI answer was cut off. Try again.');
  return (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// An HTTP-level failure; `retryable` means the Gemini chain should move on to the next model.
class HttpFailure extends Error {
  constructor(message, status, retryable) { super(message); this.status = status; this.retryable = retryable; }
}

// POSTs JSON with a per-attempt timeout combined manually with the caller's signal (no AbortSignal.any).
// Caller aborts rethrow the caller's AbortError; timeouts and fallback-worthy HTTP errors become retryable HttpFailures.
async function postJson({ url, headers, body }, signal, timeoutMs) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throwIfAborted(signal);
      if (timedOut) throw new HttpFailure(`The review timed out after ${Math.round(timeoutMs / 1000)} seconds. Try again.`, 408, true);
      throw new ReviewError('Could not reach the AI service. Check your connection and try again.');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throwIfAborted(signal);
      throw new HttpFailure(httpMessage(res.status, detail), res.status, isRetryable(res.status, detail));
    }
    try { return await res.json(); }
    catch {
      throwIfAborted(signal);
      if (timedOut) throw new HttpFailure('The review timed out. Try again.', 408, true);
      throw new ReviewError('The AI service sent an unreadable response. Try again.');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

const keyRejected = (status, detail) => status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail);
const isRetryable = (status, detail) => !keyRejected(status, detail) && FALLBACK_HTTP.has(status);

export function httpMessage(status, detail = '') {
  if (keyRejected(status, detail)) return 'API key rejected.';
  if (status === 429) return 'Rate limited, try again shortly.';
  if (status === 404) return 'This AI model is not available for your key.';
  if (status === 408 || status >= 500) return 'The AI service is busy or unavailable. Try again shortly.';
  if (status === 413) return 'The photo is too large. Try a smaller image.';
  return `The AI service rejected the request (HTTP ${status}).`;
}

function abortError(signal) {
  if (signal?.reason !== undefined) return signal.reason;
  try { return new DOMException('The operation was aborted.', 'AbortError'); }
  catch { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; }
}
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(signal); }
function safeStatus(fn, text) { try { fn?.(text); } catch { /* a UI callback must not break the review */ } }

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => { clearTimeout(id); reject(abortError(signal)); };
    const id = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}
