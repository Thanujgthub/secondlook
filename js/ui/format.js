// Dates and times in the ward office's own terms (India, 12-hour clock).
const LOCALE = 'en-IN';
const TZ = 'Asia/Kolkata';

const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const formatTime = (d) => timeFmt.format(new Date(d)).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`);
export const formatDay = (d) => dayFmt.format(new Date(d));
export const formatStamp = (d) => `${formatDay(d)}, ${formatTime(d)}`;

// "4 days ago", "yesterday", "3 hours ago", "just now".
export function ago(d, now = Date.now()) {
  const diff = (new Date(d).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function isoAttr(d) {
  try { return new Date(d).toISOString(); } catch { return ''; }
}
