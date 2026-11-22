// Live settings popover: provider + API key, kept in sessionStorage (this tab only). The key is never logged.
import { $ } from './dom.js';

const KEY_PROVIDER = 'secondlook.provider';
const KEY_APIKEY = 'secondlook.apiKey';

const read = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k, v) => {
  try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* storage blocked: keep in memory only */ }
};

export function createSettings({ onChange }) {
  const btn = $('settings-btn');
  const pop = $('settings');
  const keyInput = $('api-key');
  const dot = $('key-dot');
  const radios = [...pop.querySelectorAll('input[name="provider"]')];
  const keys = new Map(radios.map(({ value }) => [value, read(`${KEY_APIKEY}.${value}`) || '']));
  // The old shared entry cannot reliably be attributed to either provider.
  write(KEY_APIKEY, '');

  const state = {
    provider: read(KEY_PROVIDER) === 'claude' ? 'claude' : 'gemini',
  };
  radios.forEach((r) => { r.checked = r.value === state.provider; });
  const get = () => ({ ...state, apiKey: keys.get(state.provider) });

  const sync = () => {
    const { apiKey } = get();
    dot.hidden = !apiKey;
    btn.setAttribute('aria-label', apiKey ? 'AI settings (key added)' : 'AI settings (no key)');
  };
  keyInput.value = get().apiKey;
  sync();

  radios.forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    state.provider = r.value;
    write(KEY_PROVIDER, state.provider);
    keyInput.value = get().apiKey;
    sync();
    onChange(get());
  }));
  keyInput.addEventListener('input', () => {
    const apiKey = keyInput.value.trim();
    keys.set(state.provider, apiKey);
    write(`${KEY_APIKEY}.${state.provider}`, apiKey);
    sync();
    onChange(get());
  });
  $('key-clear').addEventListener('click', () => {
    keyInput.value = '';
    keyInput.dispatchEvent(new Event('input'));
    keyInput.focus();
  });

  const isOpen = () => !pop.hidden;
  function open({ focusKey = false } = {}) {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (focusKey ? keyInput : pop.querySelector('input[name="provider"]:checked')).focus();
  }
  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus();
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  $('settings-done').addEventListener('click', () => close());
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !pop.contains(e.target) && !btn.contains(e.target)) close({ restoreFocus: false });
  });
  pop.addEventListener('focusout', (e) => {
    if (isOpen() && e.relatedTarget && !pop.contains(e.relatedTarget) && e.relatedTarget !== btn) close({ restoreFocus: false });
  });

  return { get, open, close, isOpen };
}
