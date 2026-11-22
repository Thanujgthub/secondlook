// The "Second look" panel body: idle, reviewing, result and error states.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { CHECK_META, VERDICT_ICON, VERDICT_TONE } from './status.js';
import { formatTime } from './format.js';

const CLAIMS = ['Location', 'Time of day', 'Lamp state', 'Coverage'];

export function renderIdle(body, { lines }) {
  mount(body,
    h('div.idle', {},
      h('p.idle-lead', {}, ...lines.map((l, i) => (i ? [h('br'), l] : l))),
      h('ul.idle-claims', { 'aria-label': 'What a second look checks' },
        CLAIMS.map((c) => h('li', {}, h('span.idle-claim', { text: c }), h('span.idle-bar', { 'aria-hidden': 'true' })))),
    ));
}

export function renderLoading(body, { text }) {
  mount(body,
    h('div.loading', { 'aria-busy': 'true' },
      h('p.loading-status', {}, h('span.loading-pip', { 'aria-hidden': 'true' }), h('span', { id: 'loading-text', text })),
      h('div.sk.sk-banner', { 'aria-hidden': 'true' }),
      h('div.sk.sk-line', { 'aria-hidden': 'true' }),
      h('div.sk.sk-line.short', { 'aria-hidden': 'true' }),
      h('ul.sk-checks', { 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('li', {}, h('span.sk'), h('span.sk'), h('span.sk')))),
    ));
}

export function updateLoadingText(body, text) {
  const t = body.querySelector('#loading-text');
  if (t) t.textContent = text;
}

export function renderError(body, { message, canRetry, onRetry, extra }) {
  mount(body,
    h('div.error', { role: 'alert' },
      h('div.error-head', {}, icon('alert'), h('h3', { text: 'Review unavailable' })),
      h('p.error-msg', { text: message }),
      h('div.error-actions', {},
        canRetry ? h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: onRetry }, icon('retry'), 'Retry') : null,
        extra || null),
    ));
}

export function renderResult(body, { review, statusLabel, ranAt, photoLabel, message, onMessage }) {
  const tone = VERDICT_TONE[review.status] || 'neutral';
  const counts = { pass: 0, fail: 0, unclear: 0 };
  for (const c of review.checks) counts[c.result] = (counts[c.result] || 0) + 1;
  const tally = [`${review.checks.length} checks`]
    .concat(['pass', 'fail', 'unclear'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k === 'pass' ? 'pass' : k}`))
    .join(' · ');

  const showMessage = review.status !== 'ready' && review.next_photo_request;
  const msgLabel = review.status === 'not_fixed' ? 'Message to field crew: what still needs repair' : 'Message to field crew: the photo to take next';

  mount(body,
    h(`div.result.tone-${tone}`, {},
      h('div.verdict', {},
        h('span.verdict-icon', {}, icon(VERDICT_ICON[review.status] || 'info')),
        h('div.verdict-text', {},
          h('h3.verdict-label', { text: statusLabel }),
          h('p.verdict-tally', { text: tally }))),
      h('p.observation', { text: review.observation }),

      h('div.checks-wrap', {},
        h('div.checks-head', { 'aria-hidden': 'true' },
          h('span', { text: 'Check' }), h('span', { text: 'Complaint needs' }), h('span'), h('span', { text: 'Photo shows' }), h('span.r', { text: 'Result' })),
        h('ol.checks', { 'aria-label': 'Checks: what the complaint needs against what the photo shows' },
          review.checks.map((c, i) => {
            const m = CHECK_META[c.result] || CHECK_META.unclear;
            return h(`li.check.is-${c.result}`, { style: `--i:${i}` },
              h('span.check-label', { text: c.label }),
              h('span.check-needs', {}, h('span.sr-only', { text: 'Complaint needs: ' }), h('span.check-k', { 'aria-hidden': 'true', text: 'Needs' }), c.expected),
              h('span.check-arrow', { 'aria-hidden': 'true' }, icon('arrow')),
              h('span.check-seen', {}, h('span.sr-only', { text: 'Photo shows: ' }), h('span.check-k', { 'aria-hidden': 'true', text: 'Shows' }), c.seen),
              h(`span.check-result.tone-${m.tone}`, {}, icon(m.icon), h('span', { text: m.label })));
          }))),

      showMessage ? h('div.crew-msg', {},
        h('label', { for: 'crew-msg' }, icon('message'), msgLabel),
        h('textarea', { id: 'crew-msg', rows: 3, 'aria-describedby': 'crew-msg-hint', oninput: (e) => onMessage(e.target.value) }),
        h('p.hint', { id: 'crew-msg-hint', text: 'Edit this draft before recording your practice decision.' })) : null,

      h('p.checked-by', {},
        icon('scan'),
        h('span', {}, 'Checked by ', h('strong', { text: review.model || 'AI' }), ` on ${photoLabel} · ${formatTime(ranAt)}`)),
    ));
  const ta = body.querySelector('#crew-msg');
  if (ta) ta.value = message;
}
