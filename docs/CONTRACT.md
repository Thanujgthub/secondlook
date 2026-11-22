# SecondLook v2 build contract (shared by all agents)

Static site, no build step, no framework, no npm deps at runtime. Deployed to GitHub Pages at
https://thanujgthub.github.io/secondlook/ — RELATIVE paths only (`./samples/x.jpg`, never `/samples`).
Plain ES modules. Everything must work offline-of-AI in Demo mode.

## Product story (what judges must get in 60 seconds)

A ward supervisor closes streetlight complaints. Field crews mark them "fixed" and attach a photo.
SecondLook takes a second look: it splits the complaint into checkable claims (place, time of day,
lamp state, how many lights) and checks each against what the photo visibly shows. Outcome:
- `ready`        — "Ready for sign-off": the photo answers the complaint. Supervisor decides.
- `needs_photo`  — "Needs a better photo": the photo can't prove it (daytime, wrong place, too narrow).
- `not_fixed`    — "Repair incomplete": the photo shows the problem is still there (e.g. 2 of 5 lamps dark).
The AI never closes a case. The supervisor signs off or sends it back.

## Files and owners (nobody edits a file owned by someone else)

| Files | Owner |
| --- | --- |
| `samples/*.jpg`, `scripts/make_samples.*` | samples agent |
| `js/data.js`, `js/review.js`, `scripts/test-review.mjs`, `scripts/live-eval.mjs` | logic agent |
| `index.html`, `css/**`, `js/app.js`, `js/ui/**`, `assets/**` (except `assets/icon.svg` may be replaced) | UI agent |
| `README.md`, `docs/**`, deploy | lead |

## Sample photos — `samples/<id>.jpg`, 1600x1200 (4:3), JPEG q≈85, each < 450 KB

| id | Shows |
| --- | --- |
| `gate2-day` | DAYTIME. One streetlight pole beside a gate with a clearly readable sign "GATE 2". Lamp off. Only one pole. |
| `gate2-night` | NIGHT. Same single lamp beside the "GATE 2" sign, clearly ON. Only this one lamp in frame. |
| `gate3-night` | NIGHT. A lit lamp beside a gate whose sign reads "GATE 3" (wrong place). |
| `row-partial` | NIGHT, wide view. The "GATE 2" sign and a row of exactly 5 streetlights along the same wall/road: 3 ON, 2 clearly OFF/dark. |
| `row-full` | NIGHT, same wide view. "GATE 2" sign, all 5 streetlights ON. |

## Complaints and cases

```js
// js/data.js
export const COMPLAINTS = {
  single: 'The streetlight beside Gate 2 stays dark at night.',
  row:    'The entire row of lights by Gate 2 stays dark.',
};
export const SAMPLES = { 'gate2-day': { file: './samples/gate2-day.jpg', mimeType: 'image/jpeg', label: 'Gate 2 pole, daytime' }, ... all 5 };
export const CASES = [
  { id: 'SL-1042', title: 'Streetlight out beside Gate 2', complaintId: 'single', location: 'Gate 2, Market Road, Ward 14',
    reportedBy: 'Resident via grievance portal', reportedAt: '2026-11-18T21:40:00+05:30', crewNote: 'Lamp replaced. Marked fixed.',
    photos: ['gate2-day', 'gate2-night'] },
  { id: 'SL-1043', title: 'Whole row dark by Gate 2', complaintId: 'row', ..., photos: ['gate2-night', 'row-partial', 'row-full'] },
  { id: 'SL-1047', title: 'Lamp out at Gate 2 entrance', complaintId: 'single', ..., photos: ['gate3-night', 'gate2-night'] },
];
// Presenter script: each step selects a case + photo and runs the review.
export const DEMO_STEPS = [
  { caseId: 'SL-1042', photoId: 'gate2-day',   say: 'A daytime photo can't show a lamp works at night.' },
  { caseId: 'SL-1042', photoId: 'gate2-night', say: 'The lit Gate 2 lamp answers the complaint. The supervisor signs off.' },
  { caseId: 'SL-1043', photoId: 'gate2-night', say: 'Same photo, wider complaint: one lamp says nothing about the row.' },
  { caseId: 'SL-1043', photoId: 'row-partial', say: 'The wide shot shows two lamps still dark: repair incomplete.' },
  { caseId: 'SL-1043', photoId: 'row-full',    say: 'All five lit: ready for sign-off.' },
];
export const DEMO_RESULTS = { '<photoId>|<complaintId>': Review }  // all 10 combinations
```

Expected outcomes (demo data AND live model must agree):

| photo | single | row |
| --- | --- | --- |
| gate2-day | needs_photo | needs_photo |
| gate2-night | ready | needs_photo |
| gate3-night | needs_photo | needs_photo |
| row-partial | ready (Gate 2 lamp itself is lit) | not_fixed |
| row-full | ready | ready |

## Review shape

```js
// Review
{
  status: 'ready' | 'needs_photo' | 'not_fixed',
  observation: string,               // one sentence summary citing visible details
  checks: [                          // 2–5 items, the complaint split into checkable claims
    { label: string,                 // 'Location' | 'Time of day' | 'Lamp state' | 'Coverage' ...
      expected: string,              // what the complaint needs, e.g. 'Lamp beside Gate 2'
      seen: string,                  // what the photo shows, e.g. 'Sign reads GATE 3'
      result: 'pass' | 'fail' | 'unclear' }
  ],
  next_photo_request: string | null, // null iff ready. needs_photo: what photo to take next.
                                     // not_fixed: instruction to the crew (what still needs repair).
  model: string,                     // set by review.js, e.g. 'Gemini 3.6 Flash', 'Claude Haiku 5.5', 'Demo data'
}
```

## js/review.js exports

```js
export async function reviewPhoto({ complaint, image /* {dataUrl, mimeType} | null in demo */, photoId /* sample id or null */,
  mode /* 'demo'|'live' */, provider /* 'gemini'|'claude' */, apiKey, signal, onStatus /* optional (text) => void */ }) -> Promise<Review>
export class ReviewError extends Error {}
export class DemoUnavailableError extends ReviewError {}
export const STATUS_LABELS = { ready: 'Ready for sign-off', needs_photo: 'Needs a better photo', not_fixed: 'Repair incomplete' };
```
- Demo: complaint must equal one of COMPLAINTS (trimmed) and photoId must be a sample, else DemoUnavailableError. ~900 ms delay (abortable).
- Live Gemini: model fallback chain `gemini-3.8-flash` → `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3.1-flash-lite`.
  Move to the next model on HTTP 503/500/429/404 or a 25 s per-attempt timeout; call `onStatus('Gemini 3.8 Flash is busy, trying Gemini 3.7 Flash…')`.
  401/403/400 API_KEY_INVALID => "API key rejected." (no fallback).
- Live Claude: `claude-haiku-5-5` (as v1).
- AbortError from the caller's signal passes through unwrapped.
