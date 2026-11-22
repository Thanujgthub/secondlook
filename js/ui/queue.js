// Case queue: one row per case with ID, title, location, age and a live status chip.
import { h, mount } from './dom.js';
import { ago, isoAttr } from './format.js';
import { chip, chipKey } from './status.js';

export function renderQueue(list, { cases, states, selectedId, onSelect }) {
  mount(list, cases.map((c) => {
    const selected = c.id === selectedId;
    return h('li', {},
      h(`button.q-item${selected ? '.is-selected' : ''}`, {
        type: 'button', 'aria-current': selected ? 'true' : null, dataset: { case: c.id },
        onclick: () => onSelect(c.id),
      },
      h('span.q-top', {},
        h('span.q-id', { text: c.id, translate: 'no' }),
        h('time.q-age', { datetime: isoAttr(c.reportedAt), text: ago(c.reportedAt) })),
      h('span.q-title', { text: c.title }),
      h('span.q-loc', { text: c.location }),
      h('span.q-chip', {}, chip(chipKey(states[c.id])))));
  }));
}
