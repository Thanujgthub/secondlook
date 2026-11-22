// Evidence viewer: the large photo, the filmstrip of submitted attempts, and the scan overlay.
import { $, h, mount, prefersReducedMotion } from './dom.js';
import { icon } from './icons.js';

const stage = $('stage');
const img = $('stage-img');
const empty = $('stage-empty');
const strip = $('filmstrip');
const scanText = $('scan-text');

// items: [{ key, src, label, attempt }] ; selectedKey ; onSelect(key)
export function renderFilmstrip(items, selectedKey, onSelect, { extra } = {}) {
  mount(strip,
    items.map((it, i) => {
      const selected = it.key === selectedKey;
      const btn = h('button.thumb', {
        type: 'button', role: 'radio', 'aria-checked': String(selected), tabindex: selected ? '0' : '-1',
        'aria-label': `${it.attempt}: ${it.label}`, dataset: { key: it.key },
        onclick: () => onSelect(it.key),
      },
      h('span.thumb-img', {}, h('img', { src: it.src, alt: '', width: 96, height: 72, loading: 'lazy', decoding: 'async' })),
      h('span.thumb-cap', {}, h('span.thumb-n', { text: it.attempt }), h('span.thumb-l', { text: it.label })));
      btn.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        const next = items[(i + d + items.length) % items.length];
        onSelect(next.key);
        requestAnimationFrame(() => strip.querySelector(`[data-key="${CSS.escape(next.key)}"]`)?.focus());
      });
      return btn;
    }),
    extra || null);
}

let lastSrc = '';
export function showPhoto(src, alt) {
  empty.hidden = true;
  img.hidden = false;
  img.alt = alt;
  if (src === lastSrc) return;
  lastSrc = src;
  stage.classList.add('is-swapping');
  img.onload = img.onerror = () => stage.classList.remove('is-swapping');
  img.src = src;
}

export function showEmpty(children) {
  lastSrc = '';
  img.hidden = true;
  img.removeAttribute('src');
  empty.hidden = false;
  mount(empty, children);
}

export function setScanning(on, text = '') {
  stage.classList.toggle('is-scanning', on);
  stage.classList.toggle('is-static', on && prefersReducedMotion());
  scanText.textContent = text;
}

export function flashDone(tone) {
  if (prefersReducedMotion()) return;
  stage.dataset.done = tone;
  stage.classList.remove('is-done');
  void stage.offsetWidth; // restart the settle animation
  stage.classList.add('is-done');
  setTimeout(() => stage.classList.remove('is-done'), 900);
}

export function dropzone({ live, onFile, onSwitchLive, error }) {
  if (!live) {
    return h('div.dz.dz-locked', {},
      icon('closed', 'dz-icon'),
      h('p.dz-title', { text: 'Your own photos need Live mode' }),
      h('p.dz-sub', { text: 'Demo data only covers the sample cases. Switch to Live and add a Gemini or Claude API key to check any photo against any complaint.' }),
      h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: onSwitchLive }, 'Switch to Live'));
  }
  const input = h('input.sr-only', { type: 'file', id: 'own-file', accept: 'image/jpeg,image/png,.jpg,.jpeg,.png', 'aria-describedby': 'own-file-hint own-file-error' });
  input.addEventListener('change', () => input.files?.[0] && onFile(input.files[0]));
  const zone = h('div.dz', {},
    icon('upload', 'dz-icon'),
    h('p.dz-title', {}, 'Drop a repair photo here, or ', h('label.dz-link', { for: 'own-file', text: 'choose a file' })),
    h('p.dz-sub', { id: 'own-file-hint', text: 'JPG or PNG, up to 5 MB.' }),
    h('p.dz-error', { id: 'own-file-error', role: 'alert', text: error || '' }),
    input);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
  return zone;
}
