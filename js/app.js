import { SAMPLES, COMPLAINTS } from './data.js';
import { reviewPhoto, ReviewError, DemoUnavailableError } from './review.js';

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg'];
const STORE_KEY = 'secondlook.apiKey';
const STORE_PROVIDER = 'secondlook.provider';
const DEMO_HINT = 'Demo mode covers the sample photos and preset complaints. Switch to Live and add an API key to review your own.';
const STEPS = [
  { complaint: 'single', sample: 'gate2-day' },
  { complaint: 'single', sample: 'gate2-night' },
  { complaint: 'row', sample: 'gate2-night' },
];
const ICONS = {
  ready: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7"/></svg>',
  needs_photo: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h3l1.5-2h5L14 7h3v8H3z"/><circle cx="10" cy="11" r="2.5"/></svg>',
  error: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 6v5M10 14v.01"/><circle cx="10" cy="10" r="7.5"/></svg>',
};

const els = {
  form: $('review-form'), complaint: $('complaint'), chips: $('chips'), samples: $('samples'),
  upload: $('upload'), uploadError: $('upload-error'), preview: $('preview'), previewImg: $('preview-img'),
  previewCap: $('preview-cap'), hint: $('demo-hint'), reviewBtn: $('review-btn'), formError: $('form-error'),
  result: $('result'), accept: $('accept-btn'), followup: $('followup-btn'), decision: $('decision'),
  liveFields: $('live-fields'), modeNote: $('mode-note'), provider: $('provider'), apiKey: $('api-key'),
};

// image: { sampleId, src, label, mimeType, dataUrl } — dataUrl loaded lazily for samples.
const state = { image: null, review: null, error: null, decision: null, running: false, controller: null, runId: 0, retryable: true };
let uploadSeq = 0; // a newer photo choice cancels a slow upload read

const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const mode = () => els.form.elements.mode.value;
const complaintText = () => els.complaint.value.trim();
const presetFor = (text) => COMPLAINTS.find((c) => c.text === text);

// ---------- Inputs ----------

function buildInputs() {
  for (const c of COMPLAINTS) {
    const chip = el('button', 'chip', c.label);
    chip.type = 'button';
    chip.dataset.id = c.id;
    chip.title = c.text;
    chip.addEventListener('click', () => setComplaint(c.text));
    els.chips.append(chip);
  }
  for (const s of SAMPLES) {
    const label = el('label', 'sample');
    const input = el('input', 'sr-only');
    Object.assign(input, { type: 'radio', name: 'sample', value: s.id });
    input.addEventListener('change', () => selectSample(s.id));
    const img = el('img');
    Object.assign(img, { src: s.file, alt: '', width: 160, height: 120, decoding: 'async' });
    label.append(input, img, el('span', null, s.label));
    els.samples.append(label);
  }
}

function setComplaint(text) {
  if (els.complaint.value === text) return;
  els.complaint.value = text;
  invalidate();
}

function selectSample(id) {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return;
  if (state.image?.sampleId === id) return;
  els.form.elements.sample.forEach((r) => { r.checked = r.value === id; });
  uploadSeq++;
  els.upload.value = '';
  els.uploadError.textContent = '';
  setImage({ sampleId: id, src: s.file, label: s.label, mimeType: 'image/png', dataUrl: null });
}

function handleUpload() {
  const file = els.upload.files[0];
  els.uploadError.textContent = '';
  if (!file) return;
  if (!TYPES.includes(file.type)) return rejectUpload('That file is not a JPG or PNG. Choose a .jpg or .png photo.');
  if (file.size > MAX_BYTES) return rejectUpload(`That photo is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`);
  const seq = ++uploadSeq;
  readAsDataUrl(file).then((dataUrl) => {
    if (seq !== uploadSeq) return;
    els.form.elements.sample.forEach((r) => { r.checked = false; });
    setImage({ sampleId: null, src: dataUrl, label: `Uploaded: ${file.name}`, mimeType: file.type, dataUrl });
  }, () => seq === uploadSeq && rejectUpload('That photo could not be read. Try another file.'));
}

function rejectUpload(message) {
  els.upload.value = '';
  els.uploadError.textContent = message;
}

function setImage(image) {
  state.image = image;
  els.previewImg.src = image.src;
  els.previewImg.alt = image.sampleId ? `Repair photo: ${image.label}` : 'Uploaded repair photo';
  els.previewCap.textContent = image.label;
  els.preview.hidden = false;
  invalidate();
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function loadSampleDataUrl(image) {
  if (image.dataUrl) return image.dataUrl;
  const res = await fetch(image.src);
  if (!res.ok) throw new ReviewError('The sample photo could not be loaded. Reload the page and try again.');
  image.dataUrl = await readAsDataUrl(await res.blob());
  return image.dataUrl;
}

// Any change to the complaint or photo makes the old result stale: drop it and any decision.
function invalidate() {
  state.controller?.abort();
  Object.assign(state, { review: null, error: null, decision: null, running: false, controller: null });
  state.runId++;
  els.formError.textContent = '';
  render();
}

// ---------- Review ----------

async function runReview() {
  const complaint = complaintText();
  els.formError.textContent = '';
  if (!complaint) return formError('Add the complaint text first.', els.complaint);
  if (!state.image) return formError('Choose a sample photo or upload one first.', els.samples.querySelector('input'));
  const live = mode() === 'live';
  const apiKey = els.apiKey.value.trim();
  if (live && !apiKey) return formError('Add an API key to run a live review.', els.apiKey);
  const provider = els.provider.value;
  const via = live ? els.provider.selectedOptions[0].text : 'Demo';

  state.controller?.abort();
  const controller = new AbortController();
  const runId = ++state.runId;
  Object.assign(state, { controller, running: true, review: null, error: null, decision: null });
  render();
  if (document.activeElement === document.body || document.activeElement === els.reviewBtn) els.result.focus({ preventScroll: true });

  try {
    const image = state.image;
    // Demo mode never sends the image, so it needs no fetch.
    const dataUrl = !live ? null : image.sampleId ? await loadSampleDataUrl(image) : image.dataUrl;
    const review = await reviewPhoto({
      complaint,
      image: { dataUrl, mimeType: image.mimeType },
      sampleId: image.sampleId,
      mode: live ? 'live' : 'demo',
      provider: live ? provider : undefined,
      apiKey: live ? apiKey : undefined,
      signal: controller.signal,
    });
    if (runId !== state.runId) return;
    state.review = { ...review, complaint, photo: image.label, via };
  } catch (err) {
    if (runId !== state.runId || err?.name === 'AbortError') return;
    state.retryable = !(err instanceof DemoUnavailableError);
    state.error = err instanceof DemoUnavailableError ? DEMO_HINT
      : err instanceof ReviewError ? err.message
      : 'Something went wrong while checking the photo. Try again.';
  }
  state.running = false;
  state.controller = null;
  render();
}

function formError(message, focusTarget) {
  els.formError.textContent = message;
  focusTarget?.focus();
}

function decide(kind) {
  if (!state.review || state.decision || state.running) return;
  if (kind === 'accept' && state.review.status !== 'ready') return;
  state.decision = kind;
  render();
  els.decision.focus();
}

// ---------- Rendering ----------

function render() {
  renderResult();
  const { review, decision, running } = state;
  const fresh = Boolean(review) && !running && !decision;
  els.accept.disabled = !(fresh && review.status === 'ready');
  els.followup.disabled = !fresh;
  els.decision.className = `decision${decision ? ` is-${decision}` : ''}`;
  els.decision.textContent = decision === 'accept' ? 'Complaint closed by supervisor.'
    : decision === 'followup' ? `Follow-up sent to the field team${review?.next_photo_request ? `: ${review.next_photo_request}` : '.'}`
    : '';
  els.reviewBtn.disabled = running;
  els.reviewBtn.classList.toggle('is-busy', running);
  els.reviewBtn.querySelector('.btn-label').textContent = running ? 'Reviewing…' : 'Review photo';
  syncInputs();
}

function renderResult() {
  const box = els.result;
  box.replaceChildren();
  box.setAttribute('aria-busy', String(state.running));
  if (state.running) {
    const p = el('p', 'result-loading');
    p.append(el('span', 'spinner'), el('span', null, 'Checking the photo against the complaint…'));
    box.append(p);
    return;
  }
  if (state.error) {
    const badge = el('p', 'badge badge-error');
    badge.innerHTML = ICONS.error;
    badge.append(el('span', null, 'Review unavailable'));
    const retry = el('button', 'btn btn-secondary btn-small', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', runReview);
    box.append(badge, el('p', 'result-text', state.error));
    if (state.retryable) box.append(retry);
    return;
  }
  const r = state.review;
  if (!r) {
    box.append(el('p', 'result-empty', 'No review yet. Choose a complaint and a repair photo, then select Review photo.'));
    return;
  }
  const ready = r.status === 'ready';
  const badge = el('p', `badge ${ready ? 'badge-ready' : 'badge-needs'}`);
  badge.innerHTML = ICONS[ready ? 'ready' : 'needs_photo'];
  badge.append(el('span', null, ready ? 'Ready for human review' : 'Request another photo'));
  box.append(badge, el('h3', 'result-label', 'What the photo shows'), el('p', 'result-text', r.observation));
  if (r.next_photo_request) {
    box.append(el('h3', 'result-label', 'Photo needed'), el('p', 'result-request', r.next_photo_request));
  }
  const meta = el('dl', 'result-meta');
  for (const [k, v] of [['Complaint', `“${r.complaint}”`], ['Photo', r.photo], ['Checked by', r.via]]) {
    meta.append(el('dt', null, k), el('dd', null, v));
  }
  box.append(meta);
}

function syncInputs() {
  const text = complaintText();
  const preset = presetFor(text);
  for (const chip of els.chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.id === preset?.id));
  document.querySelectorAll('.step').forEach((btn) => {
    const s = STEPS[btn.dataset.step];
    const current = preset?.id === s.complaint && state.image?.sampleId === s.sample;
    current ? btn.setAttribute('aria-current', 'step') : btn.removeAttribute('aria-current');
  });
  const custom = (text && !preset) || (state.image && !state.image.sampleId);
  els.hint.hidden = !(mode() === 'demo' && custom);
}

function syncMode() {
  const live = mode() === 'live';
  els.liveFields.hidden = !live;
  els.modeNote.textContent = live
    ? 'Live sends the complaint and photo to the selected model. Use your own key.'
    : 'Demo uses saved reviews for the sample photos and preset complaints. No key needed.';
  syncInputs();
}

// ---------- Wiring ----------

function runStep(index) {
  const step = STEPS[index];
  setComplaint(COMPLAINTS.find((c) => c.id === step.complaint).text);
  selectSample(step.sample);
  if (mode() !== 'demo') return els.reviewBtn.focus();
  runReview();
  // On stacked (narrow) layouts the result sits far below; bring it into view.
  if (matchMedia('(max-width: 880px)').matches) els.result.closest('.result').scrollIntoView({ block: 'start' });
}

function init() {
  buildInputs();
  els.complaint.addEventListener('input', invalidate);
  els.upload.addEventListener('change', handleUpload);
  els.form.addEventListener('submit', (e) => { e.preventDefault(); runReview(); });
  els.form.addEventListener('change', (e) => { if (e.target.name === 'mode') { syncMode(); invalidate(); } });
  els.accept.addEventListener('click', () => decide('accept'));
  els.followup.addEventListener('click', () => decide('followup'));
  document.querySelectorAll('.step').forEach((btn) => btn.addEventListener('click', () => runStep(Number(btn.dataset.step))));

  els.apiKey.value = session.get(STORE_KEY) || '';
  els.apiKey.addEventListener('input', () => session.set(STORE_KEY, els.apiKey.value.trim()));
  const provider = session.get(STORE_PROVIDER);
  if (provider === 'claude' || provider === 'gemini') els.provider.value = provider;
  els.provider.addEventListener('change', () => session.set(STORE_PROVIDER, els.provider.value));

  syncMode();
  render();
}

init();
