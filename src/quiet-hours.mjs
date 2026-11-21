export const defaultQuietHours = { enabled: false, start: '22:00', end: '07:00', timeZone: 'Europe/Berlin', allowDing: true };

export function normalizeQuietHours(value) {
  const { enabled, start, end, timeZone, allowDing } = value || {};
  const isTime = time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (typeof enabled !== 'boolean' || typeof allowDing !== 'boolean' || !isTime(start) || !isTime(end) || start === end || typeof timeZone !== 'string' || timeZone.length > 80) throw Error('Push-Ruhezeiten ungültig.');
  try { new Intl.DateTimeFormat('de-DE', { timeZone }); }
  catch { throw Error('Zeitzone ungültig.'); }
  return { enabled, start, end, timeZone, allowDing };
}

export function isQuiet(value, kind, now = new Date()) {
  if (!value?.enabled || (kind === 'ding' && value.allowDing)) return false;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: value.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return value.start < value.end ? clock >= value.start && clock < value.end : clock >= value.start || clock < value.end;
}
