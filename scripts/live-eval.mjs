// Live Gemini evaluation over all 10 sample-photo x complaint combinations.
// Usage: node scripts/live-eval.mjs <path-to-key-file> [--verbose]
// The key is read from the file and never printed. Requires samples/*.jpg.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SAMPLES, COMPLAINTS } from '../js/data.js';
import { reviewPhoto } from '../js/review.js';

const EXPECTED = {
  'gate2-day|single': 'needs_photo', 'gate2-day|row': 'needs_photo',
  'gate2-night|single': 'ready', 'gate2-night|row': 'needs_photo',
  'gate3-night|single': 'needs_photo', 'gate3-night|row': 'needs_photo',
  'row-partial|single': 'ready', 'row-partial|row': 'not_fixed',
  'row-full|single': 'ready', 'row-full|row': 'ready',
};

const keyFile = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!keyFile) { console.error('Usage: node scripts/live-eval.mjs <key-file> [--verbose]'); process.exit(2); }
const apiKey = (await readFile(keyFile, 'utf8')).trim();
if (!apiKey) { console.error('Key file is empty.'); process.exit(2); }
const scrub = (s) => String(s).split(apiKey).join('[key]');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = {};
for (const [id, s] of Object.entries(SAMPLES)) {
  const buf = await readFile(path.join(root, s.file));
  images[id] = { dataUrl: `data:${s.mimeType};base64,${buf.toString('base64')}`, mimeType: s.mimeType };
}

const MAX_TRIES = 4;
const RETRY_DELAY_MS = 5000;
let matches = 0;
let chainRetries = 0;
const rows = [];
for (const key of Object.keys(EXPECTED)) {
  const [photoId, complaintId] = key.split('|');
  const statuses = [];
  const t0 = performance.now();
  let status; let model = '-'; let detail = '';
  try {
    // Capacity errors ("every model busy") are retried so the table measures the prompt, not Gemini's load.
    let r;
    for (let attempt = 1; ; attempt++) {
      try {
        r = await reviewPhoto({
          complaint: COMPLAINTS[complaintId], image: images[photoId], photoId, mode: 'live', provider: 'gemini', apiKey,
          onStatus: (t) => statuses.push(`${Math.round(performance.now() - t0)}ms ${t}`),
        });
        break;
      } catch (err) {
        if (attempt >= MAX_TRIES || !/busy|Rate limited/.test(err.message)) throw err;
        chainRetries++;
        statuses.push(`${Math.round(performance.now() - t0)}ms all models busy, retrying the chain in ${RETRY_DELAY_MS / 1000}s`);
        await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
      }
    }
    ({ status, model } = r);
    detail = verbose ? `\n      obs: ${r.observation}\n      ${r.checks.map((c) => `[${c.result}] ${c.label}: ${c.seen}`).join('\n      ')}\n      next: ${r.next_photo_request}` : '';
  } catch (err) {
    status = `ERROR ${scrub(err.message)}`;
  }
  const ms = Math.round(performance.now() - t0);
  const ok = status === EXPECTED[key];
  if (ok) matches++;
  rows.push(`${ok ? 'MATCH' : 'MISS '}  ${key.padEnd(20)} expected ${EXPECTED[key].padEnd(11)} got ${String(status).padEnd(11)} ${model.padEnd(22)} ${String(ms).padStart(6)} ms${statuses.length ? `  (fallbacks: ${statuses.length})` : ''}${verbose && statuses.length ? `\n      ${statuses.join('\n      ')}` : ''}${detail}`);
  console.log(rows.at(-1));
}
console.log(`\n${matches}/10 match the expected table (whole-chain retries after every model was busy: ${chainRetries})`);
process.exitCode = matches >= 9 ? 0 : 1;
