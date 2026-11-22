// Queue/case status vocabulary, derived from a case's review + decision. One place, so chips agree everywhere.
import { h } from './dom.js';
import { icon } from './icons.js';

export const CHIPS = {
  awaiting: { label: 'Awaiting review', tone: 'neutral', icon: 'clock' },
  reviewing: { label: 'Reviewing…', tone: 'amber-soft', icon: 'scan' },
  needs_photo: { label: 'Needs photo', tone: 'amber', icon: 'photo' },
  not_fixed: { label: 'Repair incomplete', tone: 'red', icon: 'alert' },
  ready: { label: 'Ready', tone: 'green', icon: 'check' },
  closed: { label: 'Closed', tone: 'done', icon: 'closed' },
  sent_back: { label: 'Sent back', tone: 'blue', icon: 'return' },
};

export const VERDICT_ICON = { ready: 'check', needs_photo: 'photo', not_fixed: 'alert' };
export const VERDICT_TONE = { ready: 'green', needs_photo: 'amber', not_fixed: 'red' };
export const CHECK_META = {
  pass: { label: 'Pass', tone: 'green', icon: 'check' },
  fail: { label: 'Fail', tone: 'red', icon: 'cross' },
  unclear: { label: 'Unclear', tone: 'neutral', icon: 'unclear' },
};

export function chipKey(cs) {
  if (cs.run) return 'reviewing';
  if (cs.decision) return cs.decision.kind;
  if (cs.result) return cs.result.review.status;
  return 'awaiting';
}

export function chip(key, extraClass = '') {
  const c = CHIPS[key] || CHIPS.awaiting;
  return h(`span.chip.tone-${c.tone}${extraClass ? `.${extraClass}` : ''}`, {}, icon(c.icon), h('span', { text: c.label }));
}
