// SecondLook review logic: demo lookups and one live vision-model call per review.
// Review = { status: 'ready' | 'needs_photo', observation: string, next_photo_request: string | null }
import { COMPLAINTS, DEMO_RESULTS } from './data.js';

export class ReviewError extends Error {
  constructor(message) { super(message); this.name = 'ReviewError'; }
}
export class DemoUnavailableError extends ReviewError {
  constructor(message = 'Demo mode covers the sample photos and preset complaints. Switch to Live and add an API key to review your own.') {
    super(message); this.name = 'DemoUnavailableError';
  }
}

export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const GEMINI_MODEL = 'gemini-3.8-flash';
const TIMEOUT_MS = 30_000;
const DEMO_DELAY_MS = 700;

export const SYSTEM_PROMPT = `You check repair evidence for streetlight complaints before a ward supervisor closes them. You never close a case; you only say whether the photo is good enough for a human to review.

Steps:
1. From the complaint, identify the specific lamp or landmark named (for example a gate number or sign), the reported problem (for example dark at night), and how many lights it covers (one lamp, or a whole row/stretch).
2. Look at the photo and describe only what is actually visible. Never assume anything outside the frame: an unseen lamp is unverified, an unreadable sign is not a match, and a daytime photo cannot show that a lamp works at night.
3. Decide:
   - "ready" only if the photo visibly shows the problem fixed (for a dark lamp: taken after dark with the lamp switched on), at the landmark named in the complaint (a readable matching sign), covering every light the complaint names.
   - otherwise "needs_photo".

Return JSON only, with exactly these fields:
- "status": "ready" or "needs_photo"
- "observation": one sentence citing the visible details that led to your decision (time of day, lamp on or off, sign text, how many lights are in frame).
- "next_photo_request": when status is "needs_photo", one specific sentence telling the field worker exactly what photo to take next (when, what must be lit, what landmark must be in frame, how wide); when status is "ready", null.`;

const SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_photo'] },
    observation: { type: 'string' },
    next_photo_request: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['status', 'observation', 'next_photo_request'],
  additionalProperties: false,
};

// Validates a parsed model answer and returns a clean Review, or throws ReviewError.
export function validateReview(raw) {
  const bad = (why) => new ReviewError(`The AI returned an unusable answer (${why}). Try again.`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('not an object');
  const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : '';
  if (status !== 'ready' && status !== 'needs_photo') throw bad('unknown status');
  const observation = typeof raw.observation === 'string' ? raw.observation.trim() : '';
  if (!observation) throw bad('missing observation');
  let request = raw.next_photo_request;
  if (request !== null && request !== undefined && typeof request !== 'string') throw bad('bad photo request');
  request = typeof request === 'string' ? request.trim() : '';
  if (/^(null|none|n\/a)?$/i.test(request)) request = null;
  if (status === 'ready' && request) throw bad('ready but still asks for a photo');
  if (status === 'needs_photo' && !request) throw bad('no photo request');
  return { status, observation, next_photo_request: request };
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

export function demoKey(sampleId, complaint) {
  const text = String(complaint ?? '').trim();
  const match = COMPLAINTS.find((c) => c.text === text);
  return sampleId && match ? `${sampleId}|${match.id}` : null;
}

export async function reviewPhoto({ complaint, image, sampleId = null, mode = 'demo', provider = 'claude', apiKey, signal } = {}) {
  if (mode === 'demo') {
    const key = demoKey(sampleId, complaint);
    const result = key && DEMO_RESULTS[key];
    if (!result) throw new DemoUnavailableError();
    await delay(DEMO_DELAY_MS, signal);
    return { ...result };
  }

  if (!String(complaint ?? '').trim()) throw new ReviewError('Enter the complaint text first.');
  const base64 = String(image?.dataUrl ?? '').split(',')[1];
  const mimeType = image?.mimeType;
  if (!base64 || !['image/png', 'image/jpeg'].includes(mimeType)) throw new ReviewError('Choose a JPG or PNG photo first.');
  if (!String(apiKey ?? '').trim()) throw new ReviewError('Add an API key to use Live mode.');

  const call = provider === 'gemini' ? callGemini : provider === 'claude' ? callClaude : null;
  if (!call) throw new ReviewError('Unknown AI provider.');
  const text = await call({ complaint: complaint.trim(), base64, mimeType, apiKey: apiKey.trim(), signal });
  return validateReview(extractJson(text));
}

const userText = (complaint) => `Complaint: "${complaint}"\n\nReview the attached repair photo against this complaint.`;

async function callClaude({ complaint, base64, mimeType, apiKey, signal }) {
  const data = await postJson('https://api.anthropic.com/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  }, {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: userText(complaint) },
      ],
    }],
  }, signal);
  if (data?.stop_reason === 'refusal') throw new ReviewError('The AI declined to review this photo.');
  if (data?.stop_reason === 'max_tokens') throw new ReviewError('The AI answer was cut off. Try again.');
  return (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function callGemini({ complaint, base64, mimeType, apiKey, signal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const data = await postJson(url, { 'x-goog-api-key': apiKey }, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: userText(complaint) }] }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
  }, signal);
  if (data?.promptFeedback?.blockReason) throw new ReviewError('The AI declined to review this photo.');
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
}

// POSTs JSON with a 30 s timeout combined with the caller's signal; maps failures to user-safe errors.
async function postJson(url, headers, body, signal) {
  const signals = [AbortSignal.timeout(TIMEOUT_MS)];
  if (signal) signals.push(signal);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err; // caller cancelled: let the AbortError through
    if (err?.name === 'TimeoutError') throw new ReviewError('The review timed out after 30 seconds. Try again.');
    throw new ReviewError('Could not reach the AI service. Check your connection and try again.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ReviewError(httpMessage(res.status, detail));
  }
  try { return await res.json(); }
  catch { throw new ReviewError('The AI service sent an unreadable response. Try again.'); }
}

export function httpMessage(status, detail = '') {
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) return 'API key rejected.';
  if (status === 429) return 'Rate limited, try again shortly.';
  if (status === 408 || status >= 500) return 'The AI service is busy or unavailable. Try again shortly.';
  if (status === 413) return 'The photo is too large. Try a smaller image.';
  return `The AI service rejected the request (HTTP ${status}).`;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); reject(signal.reason); }, { once: true });
  });
}
