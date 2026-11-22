// One authored icon set: 20px grid, 1.6 stroke, round caps. Built with DOM APIs (no innerHTML).
const SVG_NS = 'http://www.w3.org/2000/svg';

// Each icon is a list of [tag, attrs] drawn on a 20x20 viewBox.
const ICONS = {
  check: [['path', { d: 'M4.5 10.5l3.5 3.5 7.5-8' }]],
  cross: [['path', { d: 'M5.5 5.5l9 9M14.5 5.5l-9 9' }]],
  unclear: [['circle', { cx: 10, cy: 10, r: 6.5 }], ['path', { d: 'M7 10h6' }]],
  close: [['path', { d: 'M5.5 5.5l9 9M14.5 5.5l-9 9' }]],
  info: [['circle', { cx: 10, cy: 10, r: 7 }], ['path', { d: 'M10 9v4.5' }], ['circle', { cx: 10, cy: 6.5, r: 0.6, fill: 'currentColor' }]],
  settings: [
    ['path', { d: 'M3.5 6h7M14.5 6h2M3.5 14h2M9.5 14h7' }],
    ['circle', { cx: 12.5, cy: 6, r: 2 }],
    ['circle', { cx: 7.5, cy: 14, r: 2 }],
  ],
  present: [['rect', { x: 3, y: 4, width: 14, height: 9.5, rx: 1.5 }], ['path', { d: 'M8.5 7l3.5 2-3.5 2z', fill: 'currentColor' }], ['path', { d: 'M7 16.5h6' }]],
  upload: [['path', { d: 'M10 13V4M6.5 7.5L10 4l3.5 3.5' }], ['path', { d: 'M4 12.5v2A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-2' }]],
  lamp: [['path', { d: 'M6 17.5V6a3 3 0 0 1 3-3h3.5' }], ['path', { d: 'M4 17.5h4' }], ['path', { d: 'M11.5 5h3.5' }], ['path', { d: 'M12.5 8l-1 3M15.5 8l1.5 3', opacity: 0.6 }]],
  scan: [
    ['path', { d: 'M3.5 7V5A1.5 1.5 0 0 1 5 3.5h2M13 3.5h2A1.5 1.5 0 0 1 16.5 5v2M16.5 13v2a1.5 1.5 0 0 1-1.5 1.5h-2M7 16.5H5A1.5 1.5 0 0 1 3.5 15v-2' }],
    ['path', { d: 'M6 10h8' }],
  ],
  return: [['path', { d: 'M8 5.5L4.5 9 8 12.5' }], ['path', { d: 'M4.5 9H12a3.5 3.5 0 0 1 0 7h-2' }]],
  left: [['path', { d: 'M12 5l-5 5 5 5' }]],
  right: [['path', { d: 'M8 5l5 5-5 5' }]],
  arrow: [['path', { d: 'M4 10h11M11 6l4 4-4 4' }]],
  pin: [['path', { d: 'M10 17s5-4.6 5-8.5a5 5 0 0 0-10 0C5 12.4 10 17 10 17z' }], ['circle', { cx: 10, cy: 8.5, r: 1.8 }]],
  person: [['circle', { cx: 10, cy: 7, r: 3 }], ['path', { d: 'M4.5 16.5a5.5 5.5 0 0 1 11 0' }]],
  clock: [['circle', { cx: 10, cy: 10, r: 7 }], ['path', { d: 'M10 6v4l2.5 2' }]],
  wrench: [['path', { d: 'M12.5 3.8a3.6 3.6 0 0 0-4 5L3.8 13.5a1.6 1.6 0 0 0 2.3 2.3l4.7-4.7a3.6 3.6 0 0 0 5-4l-2.2 2.1-2-.5-.5-2z' }]],
  quote: [['path', { d: 'M4 14.5c0-3.5 1.5-6 4.5-7.5M11 14.5c0-3.5 1.5-6 4.5-7.5' }], ['circle', { cx: 6, cy: 13.5, r: 2, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 13, cy: 13.5, r: 2, fill: 'currentColor', stroke: 'none' }]],
  alert: [['path', { d: 'M10 3.5L17.5 16.5h-15z' }], ['path', { d: 'M10 8.5v3.5' }], ['circle', { cx: 10, cy: 14.2, r: 0.6, fill: 'currentColor' }]],
  photo: [['rect', { x: 3, y: 4.5, width: 14, height: 11, rx: 1.5 }], ['path', { d: 'M3.5 13l4-3.5 3 2.5 2.5-2 3.5 3' }], ['circle', { cx: 13, cy: 8, r: 1.2 }]],
  closed: [['rect', { x: 4.5, y: 9, width: 11, height: 8, rx: 1.5 }], ['path', { d: 'M7 9V6.5a3 3 0 0 1 6 0V9' }]],
  dot: [['circle', { cx: 10, cy: 10, r: 3, fill: 'currentColor', stroke: 'none' }]],
  message: [['path', { d: 'M4 5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z' }]],
  retry: [['path', { d: 'M15.5 10a5.5 5.5 0 1 1-1.6-3.9' }], ['path', { d: 'M15.5 3.5v3.5H12' }]],
};

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

// Replaces every <span data-icon="name"> placeholder in static markup with its SVG.
export function hydrateIcons(root = document) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    const svg = icon(slot.dataset.icon, slot.className);
    slot.replaceWith(svg);
  }
}
