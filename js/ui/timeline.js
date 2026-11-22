// Audit trail: Reported → Crew marked fixed → Second look → Supervisor.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { formatStamp, isoAttr } from './format.js';
import { VERDICT_TONE } from './status.js';

const KIND = {
  reported: { icon: 'person', tone: 'neutral' },
  crew: { icon: 'wrench', tone: 'neutral' },
  review: { icon: 'scan', tone: null },
  closed: { icon: 'closed', tone: 'done' },
  sent_back: { icon: 'return', tone: 'blue' },
};

// events: [{ kind, title, detail?, at?, status? }]
export function renderTimeline(list, events) {
  mount(list, events.map((ev, i) => {
    const k = KIND[ev.kind] || KIND.crew;
    const tone = ev.kind === 'review' ? VERDICT_TONE[ev.status] || 'neutral' : k.tone;
    const isNew = ev.fresh && i === events.length - 1;
    return h(`li.tl-item${isNew ? '.is-new' : ''}`, {},
      h(`span.tl-mark.tone-${tone}`, {}, icon(k.icon)),
      h('div.tl-body', {},
        h('p.tl-title', { text: ev.title }),
        ev.detail ? h('p.tl-detail', { text: ev.detail }) : null),
      ev.at
        ? h('time.tl-time', { datetime: isoAttr(ev.at), text: formatStamp(ev.at) })
        : h('span.tl-time.is-missing', { text: 'Time not recorded' }));
  }));
}
