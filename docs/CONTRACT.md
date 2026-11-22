# SecondLook build contract (shared by all agents)

Static site, no build step, no framework, no npm. Deployed to GitHub Pages from the repo root.
Plain ES modules loaded by the browser. Must work when opened from a static server at a sub-path
(e.g. https://user.github.io/secondlook/), so use RELATIVE paths only (`./samples/x.png`, never `/samples`).

## Files and owners

| File | Owner |
| --- | --- |
| `samples/gate2-day.png`, `samples/gate2-night.png`, `samples/gate3-night.png` | samples agent |
| `scripts/make_samples.py` | samples agent |
| `js/data.js`, `js/review.js` | logic agent |
| `index.html`, `css/styles.css`, `js/app.js` | UI agent |
| `README.md`, `.github/workflows/pages.yml`, `.nojekyll` | lead |

Nobody edits a file owned by someone else.

## Sample photos (illustrated scenes, PNG, 1200x900)

- `gate2-day.png` — DAYTIME. One streetlight pole beside a gate with a clearly readable sign "GATE 2". Lamp is off (it's day).
- `gate2-night.png` — NIGHT. The same single lamp beside the "GATE 2" sign, clearly switched ON (glow, light cone). Only this one lamp in frame; no other poles visible.
- `gate3-night.png` — NIGHT. A lit lamp beside a gate whose sign reads "GATE 3" (the wrong location).

## js/data.js (logic agent) exports

```js
export const SAMPLES = [ { id: 'gate2-day', file: './samples/gate2-day.png', label: 'Daytime: Gate 2 pole' }, { id: 'gate2-night', ... label: 'Night: Gate 2 lamp lit' }, { id: 'gate3-night', ... label: 'Night: Gate 3 lamp lit' } ];
export const COMPLAINTS = [ { id: 'single', label: 'One lamp', text: 'The streetlight beside Gate 2 stays dark at night.' }, { id: 'row', label: 'Whole row', text: 'The entire row of lights by Gate 2 stays dark.' } ];
export const DEMO_RESULTS = { 'gate2-day|single': Review, 'gate2-night|single': Review, 'gate2-night|row': Review, 'gate3-night|single': Review, 'gate2-day|row': Review, 'gate3-night|row': Review };
```

## js/review.js (logic agent) exports

```js
// Review = { status: 'ready' | 'needs_photo', observation: string, next_photo_request: string | null }
// status 'ready'        => "Ready for human review"  (next_photo_request is null)
// status 'needs_photo'  => "Request another photo"   (next_photo_request is one specific sentence)

export async function reviewPhoto({
  complaint,      // string, the complaint text as currently typed
  image,          // { dataUrl: string, mimeType: 'image/png'|'image/jpeg' }
  sampleId,       // string | null  — set only when the image is an unmodified sample
  mode,           // 'demo' | 'live'
  provider,       // 'claude' | 'gemini'   (live only)
  apiKey,         // string                (live only)
  signal,         // AbortSignal | undefined
}) -> Promise<Review>
// Demo mode: looks up DEMO_RESULTS[`${sampleId}|${complaintId}`] where complaintId is the COMPLAINTS
// entry whose text === complaint (trimmed). Adds a short artificial delay (~700ms).
// If no match (custom text or uploaded photo) it throws DemoUnavailableError.
// Live mode: one vision-model call; validates JSON; throws ReviewError with a user-safe message on
// network/HTTP/parse failure. Never returns a partially valid Review.

export class ReviewError extends Error {}
export class DemoUnavailableError extends ReviewError {}
```

## UI behaviour (UI agent)

- One screen. Left: complaint (preset chips + editable textarea), photo (sample picker thumbnails + JPG/PNG upload, preview). Right: result panel.
- "Review photo" button calls `reviewPhoto`. While running: button disabled, spinner, Abort on new run.
- Result shows status badge (Ready for human review / Request another photo), observation, next_photo_request.
- Supervisor actions: "Accept evidence" (enabled ONLY when status==='ready' and result is fresh) and "Ask for follow-up" (enabled when any fresh result). Accepting shows "Complaint closed by supervisor".
- Any edit to complaint text or change of photo CLEARS the result and the acceptance (stale results can never be accepted).
- Error: show "Review unavailable" + message + Retry; Accept disabled.
- Mode toggle: Demo (default, no key needed, works only with presets+samples) / Live (provider select Claude|Gemini + API key field; key kept in sessionStorage only, wrapped in try/catch; never logged).
- In demo mode, uploading a photo or editing to custom text shows a clear hint: "Demo mode covers the sample photos and preset complaints. Switch to Live and add an API key to review your own."
- Guided 3-step demo strip ("1 Day photo · 2 Night photo · 3 Whole row") that sets the inputs for each step with one click.
- Responsive to 360px width, keyboard accessible, visible focus, light and dark (prefers-color-scheme).
