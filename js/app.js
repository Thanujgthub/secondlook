// SecondLook v2: the ward supervisor's evidence-review desk.
// State lives here; rendering is delegated to small modules in ./ui/.
import { CASES, COMPLAINTS, SAMPLES, DEMO_STEPS } from './data.js';
import { reviewPhoto, DemoUnavailableError, ReviewError, STATUS_LABELS } from './review.js';
import { $, h, mount, clear } from './ui/dom.js';
import { icon, hydrateIcons } from './ui/icons.js';
import { ago, formatStamp, formatTime, isoAttr } from './ui/format.js';
import { chip, chipKey, VERDICT_TONE } from './ui/status.js';
import { renderQueue } from './ui/queue.js';
import { renderFilmstrip, showPhoto, showEmpty, setScanning, flashDone, dropzone } from './ui/evidence.js';
import { renderIdle, renderLoading, updateLoadingText, renderError, renderResult } from './ui/review-panel.js';
import { renderTimeline } from './ui/timeline.js';
import { createSettings } from './ui/settings.js';
import { createPresenter } from './ui/presenter.js';

const OWN = 'own';
const MAX_BYTES = 5 * 1024 * 1024;
const UNDO_MS = 5000;
const DEMO_STATUS = ['Reading the complaint…', 'Splitting it into checks…', 'Looking at the photo…', 'Comparing each claim…'];
const PROVIDER_LABEL = { gemini: 'Gemini', claude: 'Claude' };

hydrateIcons();

// ---------- state ----------

const caseById = Object.fromEntries(CASES.map((c) => [c.id, c]));

function seedEvents(c) {
  return [
    { kind: 'reported', title: 'Reported', detail: c.reportedBy, at: c.reportedAt },
    { kind: 'crew', title: 'Crew marked fixed', detail: `“${c.crewNote}” ${c.photos.length} photos attached.`, at: c.crewMarkedAt || null },
  ];
}
const blank = () => ({ run: null, statusText: '', result: null, error: null, decision: null, message: '' });

const app = {
  mode: 'demo',
  caseId: CASES[0].id,
  states: {
    ...Object.fromEntries(CASES.map((c) => [c.id, { ...blank(), photoId: c.photos[c.photos.length - 1], events: seedEvents(c) }])),
    [OWN]: { ...blank(), image: null, complaint: '', uploadError: '', events: [] },
  },
};
let runSeq = 0;

const settings = createSettings({
  onChange: (s) => {
    $('mode-provider').textContent = ` · ${PROVIDER_LABEL[s.provider]}`;
    if (app.mode === 'live') invalidateAll();
    renderDynamic();
  },
});
$('mode-provider').textContent = ` · ${PROVIDER_LABEL[settings.get().provider]}`;

const cur = () => app.states[app.caseId];
const isOwn = (id = app.caseId) => id === OWN;
const complaintOf = (id) => (isOwn(id) ? app.states[OWN].complaint.trim() : COMPLAINTS[caseById[id].complaintId]);
const photoKeyOf = (id) => (isOwn(id) ? (app.states[OWN].image ? `upload:${app.states[OWN].image.stamp}` : '') : app.states[id].photoId);
const freshKey = (id) => [app.mode, app.mode === 'live' ? settings.get().provider : '', photoKeyOf(id), complaintOf(id)].join('|');
const isFresh = (id) => Boolean(app.states[id].result && app.states[id].result.key === freshKey(id));

function attemptLabel(id, photoId = app.states[id].photoId) {
  if (isOwn(id)) return 'your photo';
  const n = caseById[id].photos.indexOf(photoId) + 1;
  return `attempt ${n}`;
}

// Any change of photo, complaint or mode lands here: no stale result or sign-off survives it.
function invalidate(id) {
  const s = app.states[id];
  abortRun(id);
  s.result = null;
  s.error = null;
  s.decision = null;
  s.message = '';
  if (pendingUndo?.caseId === id) dismissToast();
}
function invalidateAll() {
  for (const id of Object.keys(app.states)) invalidate(id);
}
function abortRun(id) {
  const s = app.states[id];
  if (!s.run) return;
  s.run.controller.abort();
  clearInterval(s.run.timer);
  s.run = null;
  s.statusText = '';
  if (id === app.caseId) setScanning(false);
}

// ---------- actions ----------

function selectCase(id) {
  if (id === app.caseId) return;
  abortRun(app.caseId);
  app.caseId = id;
  renderAll();
}

function selectPhoto(photoId) {
  const s = cur();
  if (isOwn() || s.photoId === photoId) return;
  invalidate(app.caseId);
  s.photoId = photoId;
  renderDynamic();
}

function setMode(mode) {
  if (mode === app.mode) return;
  app.mode = mode;
  invalidateAll();
  renderAll();
  announce(mode === 'live' ? `Live mode, ${PROVIDER_LABEL[settings.get().provider]}.` : 'Demo data mode.');
}

function runBlocker() {
  if (!isOwn()) return null;
  const s = cur();
  if (app.mode === 'demo') return 'Your own photos need Live mode and an API key.';
  if (!s.image) return 'Add a photo first.';
  if (!s.complaint.trim()) return 'Type the resident’s complaint first.';
  return null;
}

const sampleCache = new Map();
async function sampleDataUrl(photoId, signal) {
  if (sampleCache.has(photoId)) return sampleCache.get(photoId);
  const res = await fetch(SAMPLES[photoId].file, { signal });
  if (!res.ok) throw new ReviewError('Could not load the sample photo.');
  const blob = await res.blob();
  const dataUrl = await readAsDataUrl(blob);
  const img = { dataUrl, mimeType: SAMPLES[photoId].mimeType || blob.type };
  sampleCache.set(photoId, img);
  return img;
}
function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new ReviewError('Could not read the photo.'));
    r.readAsDataURL(blob);
  });
}

async function run() {
  const id = app.caseId;
  const s = cur();
  if (runBlocker()) return;
  const { provider, apiKey } = settings.get();
  if (app.mode === 'live' && !apiKey) {
    settings.open({ focusKey: true });
    return;
  }
  abortRun(id);
  invalidate(id);

  const controller = new AbortController();
  const token = ++runSeq;
  const key = freshKey(id);
  const photoId = isOwn() ? null : s.photoId;
  s.run = { controller, token, timer: null };
  s.statusText = app.mode === 'demo' ? DEMO_STATUS[0] : `Sending the photo to ${PROVIDER_LABEL[provider]}…`;
  if (app.mode === 'demo') {
    let i = 0;
    s.run.timer = setInterval(() => setStatus(id, token, DEMO_STATUS[Math.min(++i, DEMO_STATUS.length - 1)]), 240);
  }
  renderDynamic();
  announce('Running second look.');

  try {
    const image = app.mode === 'live' ? (isOwn() ? s.image : await sampleDataUrl(photoId, controller.signal)) : null;
    const review = await reviewPhoto({
      complaint: complaintOf(id), image, photoId, mode: app.mode, provider, apiKey, signal: controller.signal,
      onStatus: (text) => { setStatus(id, token, text); announce(text); },
    });
    if (s.run?.token !== token) return;
    const at = new Date();
    s.result = { review, key, at, photoId };
    s.message = review.next_photo_request || '';
    s.events.push({
      kind: 'review', status: review.status, fresh: true, at,
      title: `Second look: ${STATUS_LABELS[review.status]}`,
      detail: `${capital(attemptLabel(id, photoId))}${photoId ? ` (${SAMPLES[photoId].label})` : ''} · ${review.model}`,
    });
    finishRun(id);
    flashDone(VERDICT_TONE[review.status]);
    announce(`${STATUS_LABELS[review.status]}. ${review.observation}`);
  } catch (err) {
    if (s.run?.token !== token) return;
    if (err?.name === 'AbortError') return;
    s.error = {
      message: err instanceof ReviewError ? err.message : 'Something went wrong reaching the AI. Check your connection and try again.',
      canRetry: !(err instanceof DemoUnavailableError),
    };
    finishRun(id);
    announce(`Review unavailable. ${s.error.message}`);
  }
}

function finishRun(id) {
  const s = app.states[id];
  clearInterval(s.run?.timer);
  s.run = null;
  s.statusText = '';
  if (id === app.caseId) setScanning(false);
  renderDynamic();
}

function setStatus(id, token, text) {
  const s = app.states[id];
  if (s.run?.token !== token) return;
  s.statusText = text;
  if (id === app.caseId) {
    setScanning(true, text);
    updateLoadingText($('review-body'), text);
  }
}

const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- decisions + undo ----------

let pendingUndo = null;

function decide(kind) {
  const id = app.caseId;
  const s = cur();
  if (!isFresh(id) || s.decision) return;
  if (kind === 'closed' && s.result.review.status !== 'ready') return;
  const at = new Date();
  const label = isOwn() ? 'This check' : id;
  const ev = kind === 'closed'
    ? { kind, at, fresh: true, title: 'Supervisor: signed off and closed', detail: `On the ${attemptLabel(id, s.result.photoId)} photo.` }
    : { kind, at, fresh: true, title: 'Supervisor: sent back to crew', detail: s.message.trim() ? `“${s.message.trim()}”` : 'Returned without a message.' };
  s.decision = { kind, at };
  s.events.push(ev);
  renderDynamic();
  showToast(kind === 'closed' ? `${label} signed off and closed.` : `${label} sent back to the crew.`, () => {
    if (s.decision?.at !== at) return;
    s.decision = null;
    s.events = s.events.filter((e) => e !== ev);
    renderDynamic();
    announce('Decision undone.');
  }, id);
}

let toastTimer = 0;
function showToast(text, undo, caseId) {
  dismissToast();
  const toast = $('toast');
  $('toast-text').textContent = text;
  toast.hidden = false;
  toast.classList.remove('is-leaving');
  pendingUndo = { undo, caseId };
  announce(`${text} Undo available for 5 seconds.`);
  toastTimer = setTimeout(dismissToast, UNDO_MS);
}
function dismissToast() {
  clearTimeout(toastTimer);
  pendingUndo = null;
  const toast = $('toast');
  if (toast.contains(document.activeElement)) $('decision-title').closest('.panel').querySelector('button')?.focus();
  toast.hidden = true;
}
$('toast-undo').addEventListener('click', () => {
  const p = pendingUndo;
  dismissToast();
  p?.undo();
});

// ---------- own photo ----------

let uploadSeq = 0;
function onOwnFile(file) {
  const s = app.states[OWN];
  const token = ++uploadSeq;
  s.uploadError = '';
  if (!['image/jpeg', 'image/png'].includes(file.type)) s.uploadError = 'That file isn’t a JPG or PNG.';
  else if (file.size > MAX_BYTES) {
    const mb = file.size / 1048576;
    s.uploadError = mb < 5.05 ? 'That photo is just over the 5 MB limit.' : `That photo is ${mb.toFixed(1)} MB. The limit is 5 MB.`;
  }
  if (s.uploadError) { renderDynamic(); return; }
  readAsDataUrl(file).then((dataUrl) => {
    if (token !== uploadSeq) return;
    invalidate(OWN);
    const at = new Date();
    s.image = { dataUrl, mimeType: file.type, name: file.name, stamp: at.getTime() };
    s.events.push({ kind: 'crew', title: 'Photo added', detail: file.name, at, fresh: true });
    renderDynamic();
  }).catch(() => {
    if (token !== uploadSeq) return;
    s.uploadError = 'Could not read that file. Try another photo.';
    renderDynamic();
  });
}

// ---------- rendering ----------

let announceTimer = 0;
function announce(text) {
  const el = $('announcer');
  clearTimeout(announceTimer);
  el.textContent = '';
  announceTimer = setTimeout(() => { el.textContent = text; }, 60);
}

function renderAll() {
  renderInputs();
  renderDynamic();
}

// Lists are re-rendered from state; keep keyboard focus on the equivalent control afterwards.
function focusKey(el) {
  if (!(el instanceof HTMLElement)) return null;
  if (el.dataset.case) return `[data-case="${CSS.escape(el.dataset.case)}"]`;
  if (el.dataset.key) return `.thumb[data-key="${CSS.escape(el.dataset.key)}"]`;
  return null;
}

function renderDynamic() {
  const active = document.activeElement;
  const restore = focusKey(active);
  renderDynamicInner();
  if (restore && !document.contains(active)) document.querySelector(restore)?.focus();
}

function renderDynamicInner() {
  renderModeControl();
  renderQueueAndHead();
  renderEvidence();
  renderReview();
  renderDecision();
  renderTimeline($('timeline'), cur().events.length ? cur().events : []);
  if (!cur().events.length) mount($('timeline'), h('li.tl-empty', { text: 'Nothing yet. Add a photo to start the trail.' }));
  for (const st of Object.values(app.states)) st.events.forEach((e) => { e.fresh = false; });
}

function renderModeControl() {
  for (const b of document.querySelectorAll('.mode-opt')) {
    const on = b.dataset.mode === app.mode;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  document.body.dataset.mode = app.mode;
  $('own-sub').textContent = app.mode === 'live' ? 'Upload a JPG or PNG, type the complaint' : 'Needs Live mode and an API key';
}

function renderQueueAndHead() {
  renderQueue($('queue-list'), { cases: CASES, states: app.states, selectedId: app.caseId, onSelect: selectCase });
  $('queue-count').textContent = `${CASES.length} cases`;
  const ownBtn = $('own-btn');
  ownBtn.setAttribute('aria-pressed', String(isOwn()));
  ownBtn.classList.toggle('is-selected', isOwn());

  const head = $('case-head');
  const s = cur();
  if (isOwn()) {
    mount(head,
      h('div.case-title', {},
        h('span.case-id', { text: 'NEW' }),
        h('h1', { text: 'Review your own photo' }),
        h('p.case-meta', {}, h('span', {}, icon('info'), 'One-off check, not linked to a ward case'))),
      h('div.case-status', {}, chip(chipKey(s), 'chip-lg')));
    return;
  }
  const c = caseById[app.caseId];
  mount(head,
    h('div.case-title', {},
      h('span.case-id', { text: c.id, translate: 'no' }),
      h('h1', { text: c.title }),
      h('p.case-meta', {},
        h('span', {}, icon('pin'), c.location),
        h('span', {}, icon('person'), c.reportedBy),
        h('span', {}, icon('clock'), h('time', { datetime: isoAttr(c.reportedAt), text: `${formatStamp(c.reportedAt)} · ${ago(c.reportedAt)}` })))),
    h('div.case-status', {}, chip(chipKey(s), 'chip-lg')));
}

function renderEvidence() {
  const s = cur();
  const meta = $('photo-meta');
  if (isOwn()) {
    if (s.image) {
      showPhoto(s.image.dataUrl, `Your uploaded photo: ${s.image.name}`);
      meta.textContent = s.uploadError ? `${s.uploadError} Keeping ${s.image.name}.` : s.image.name;
      const replace = h('label.btn.btn-ghost.btn-sm.replace', { for: 'own-replace' }, icon('upload'), 'Replace photo');
      const input = h('input.sr-only', { type: 'file', id: 'own-replace', accept: 'image/jpeg,image/png,.jpg,.jpeg,.png' });
      input.addEventListener('change', () => input.files?.[0] && onOwnFile(input.files[0]));
      renderFilmstrip([{ key: 'own', src: s.image.dataUrl, label: s.image.name, attempt: 'Your photo' }], 'own', () => {}, { extra: [replace, input] });
    } else {
      meta.textContent = '';
      showEmpty(dropzone({ live: app.mode === 'live', onFile: onOwnFile, onSwitchLive: () => setMode('live'), error: s.uploadError }));
      clear($('filmstrip'));
    }
  } else {
    const c = caseById[app.caseId];
    const sample = SAMPLES[s.photoId];
    const n = c.photos.indexOf(s.photoId) + 1;
    showPhoto(sample.file, `Attempt ${n} repair photo: ${sample.label}`);
    meta.textContent = `Attempt ${n} of ${c.photos.length}`;
    renderFilmstrip(
      c.photos.map((pid, i) => ({ key: pid, src: SAMPLES[pid].file, label: SAMPLES[pid].label, attempt: `Attempt ${i + 1}` })),
      s.photoId, selectPhoto);
  }
  setScanning(Boolean(s.run), s.statusText);
}

let reviewSig = '';
function renderReview() {
  const id = app.caseId;
  const s = cur();
  const body = $('review-body');
  const blocker = runBlocker();
  const fresh = isFresh(id);
  const { apiKey } = settings.get();

  // Header controls
  const runBtn = $('run-btn');
  runBtn.disabled = Boolean(s.run) || Boolean(blocker);
  runBtn.classList.toggle('btn-amber', !fresh);
  runBtn.classList.toggle('btn-secondary', fresh);
  $('run-label').textContent = s.run ? 'Reviewing…' : app.mode === 'live' && !apiKey && !blocker ? 'Add API key to run' : fresh ? 'Run again' : 'Run second look';
  $('cancel-btn').hidden = !s.run;
  const note = $('run-note');
  note.hidden = !blocker;
  note.textContent = blocker || '';

  const sig = [id, s.run ? `run${s.run.token}` : '', fresh ? s.result.at.getTime() : '', s.error?.message || '', blocker || '', app.mode].join('|');
  if (sig === reviewSig) return;
  reviewSig = sig;

  if (s.run) {
    renderLoading(body, { text: s.statusText });
  } else if (s.error) {
    const extra = app.mode === 'demo' && !s.error.canRetry && isOwn()
      ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => setMode('live') }, 'Switch to Live') : null;
    renderError(body, { message: s.error.message, canRetry: s.error.canRetry, onRetry: run, extra });
  } else if (fresh) {
    renderResult(body, {
      review: s.result.review,
      statusLabel: STATUS_LABELS[s.result.review.status],
      ranAt: s.result.at,
      photoLabel: attemptLabel(id, s.result.photoId),
      message: s.message,
      onMessage: (v) => { s.message = v; },
    });
  } else {
    const lines = isOwn()
      ? [blocker || 'Ready when you are.', 'SecondLook splits the complaint into checkable claims and tests each one against what the photo visibly shows.']
      : [`No second look yet on ${attemptLabel(id)}.`, 'SecondLook splits the complaint into checkable claims and tests each one against what the photo visibly shows.'];
    renderIdle(body, { lines });
  }
}

function renderDecision() {
  const id = app.caseId;
  const s = cur();
  const fresh = isFresh(id);
  const ready = fresh && s.result.review.status === 'ready';
  $('signoff-btn').disabled = !(ready && !s.decision && !s.run);
  $('sendback-btn').disabled = !(fresh && !s.decision && !s.run);
  const why = $('decision-why');
  const who = isOwn() ? 'this check' : id;
  let text;
  if (s.run) text = 'Waiting for the second look…';
  else if (s.decision?.kind === 'closed') text = `Signed off and closed at ${formatTime(s.decision.at)}. A new photo or a new review reopens it.`;
  else if (s.decision?.kind === 'sent_back') text = `Sent back to the crew at ${formatTime(s.decision.at)}.`;
  else if (!fresh) text = 'Run a second look on this photo before deciding.';
  else if (ready) text = `The photo answers the complaint. Signing off closes ${who}.`;
  else text = 'Sign-off needs a “Ready for sign-off” result. Send it back with the message above.';
  why.textContent = text;
  $('decision-panel').classList.toggle('is-decided', Boolean(s.decision));
  $('decision-panel').dataset.decision = s.decision?.kind || '';
}

function renderInputs() {
  const box = $('inputs');
  if (isOwn()) {
    const s = app.states[OWN];
    const ta = h('textarea', {
      id: 'own-complaint', rows: 3, placeholder: 'e.g. The streetlight beside Gate 2 stays dark at night…',
      'aria-describedby': 'own-complaint-hint',
    });
    ta.value = s.complaint;
    ta.addEventListener('input', () => {
      s.complaint = ta.value;
      invalidate(OWN);
      renderDynamic();
    });
    const preset = (text) => h('button.preset', {
      type: 'button', onclick: () => { ta.value = text; ta.dispatchEvent(new Event('input')); ta.focus(); },
    }, text);
    mount(box,
      h('div.panel.complaint', {},
        h('div.panel-head', {}, h('h2', {}, h('label', { for: 'own-complaint', text: 'Resident’s complaint' }))),
        ta,
        h('p.hint', { id: 'own-complaint-hint', text: 'Use the resident’s own words. The photo is checked against exactly this text.' }),
        h('div.presets', { role: 'group', 'aria-label': 'Sample complaints' }, Object.values(COMPLAINTS).map(preset))));
    return;
  }
  const c = caseById[app.caseId];
  mount(box,
    h('section.panel.complaint', { 'aria-labelledby': 'complaint-title' },
      h('div.panel-head', {}, h('h2', { id: 'complaint-title', text: 'Resident’s complaint' })),
      h('figure.quote', {},
        icon('quote', 'quote-mark'),
        h('blockquote', {}, h('p', { text: COMPLAINTS[c.complaintId] })),
        h('figcaption', {}, `${c.reportedBy} · `, h('time', { datetime: isoAttr(c.reportedAt), text: formatStamp(c.reportedAt) })))),
    h('section.panel.crew', { 'aria-labelledby': 'crew-title' },
      h('div.panel-head', {}, h('h2', { id: 'crew-title' }, 'Crew marked fixed')),
      h('p.crew-note', {}, icon('wrench'), h('span', { text: c.crewNote })),
      h('p.crew-sub', { text: `${c.photos.length} photos attached. Each attempt is checked on its own.` })));
}

// ---------- wiring ----------

$('run-btn').addEventListener('click', run);
$('cancel-btn').addEventListener('click', () => {
  abortRun(app.caseId);
  renderDynamic();
  announce('Review cancelled.');
  $('run-btn').focus();
});
$('signoff-btn').addEventListener('click', () => decide('closed'));
$('sendback-btn').addEventListener('click', () => decide('sent_back'));
$('own-btn').addEventListener('click', () => selectCase(OWN));

const modeOpts = [...document.querySelectorAll('.mode-opt')];
modeOpts.forEach((b, i) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
  b.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const next = modeOpts[(i + 1) % modeOpts.length];
    setMode(next.dataset.mode);
    next.focus();
  });
});

const presenter = createPresenter({
  steps: DEMO_STEPS,
  onStep: (step) => {
    settings.close({ restoreFocus: false });
    setMode('demo');
    if (app.caseId !== step.caseId) selectCase(step.caseId);
    const s = cur();
    if (s.photoId !== step.photoId) { invalidate(app.caseId); s.photoId = step.photoId; }
    renderDynamic();
    run();
    const stage = $('stage');
    const r = stage.getBoundingClientRect();
    if (r.top < 56 || r.bottom > innerHeight - 140) stage.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  },
});

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (settings.isOpen()) return;
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    if (!$('run-btn').disabled) run();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (presenter.isOpen()) {
      e.preventDefault();
      if (dir > 0) presenter.next(); else presenter.prev();
    } else if (!isOwn()) {
      e.preventDefault();
      const photos = caseById[app.caseId].photos;
      const i = photos.indexOf(cur().photoId);
      selectPhoto(photos[(i + dir + photos.length) % photos.length]);
    }
  }
});

// First-load context strip: the problem in one line.
const CONTEXT_KEY = 'secondlook.contextDismissed';
let contextDismissed = false;
try { contextDismissed = localStorage.getItem(CONTEXT_KEY) === '1'; } catch { /* storage blocked */ }
$('context-strip').hidden = contextDismissed;
$('context-close').addEventListener('click', () => {
  $('context-strip').hidden = true;
  try { localStorage.setItem(CONTEXT_KEY, '1'); } catch { /* storage blocked */ }
  $('case-file').focus();
});

renderAll();
