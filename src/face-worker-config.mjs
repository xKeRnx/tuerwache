const invalidUrl = 'Worker-Adresse als HTTPS-Adresse ohne Pfad angeben. HTTP ist nur auf localhost erlaubt.';
const validToken = value => typeof value === 'string' && /^[!-~]{32,256}$/.test(value);

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.length > 512) throw Error(invalidUrl);
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw Error(invalidUrl); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const validProtocol = url.protocol === 'https:' || url.protocol === 'http:' && loopback;
  if (!validProtocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error(invalidUrl);
  return url.origin;
}

export function environmentFaceWorker() {
  let url = '';
  try { url = normalizeUrl(process.env.FACE_WORKER_URL || ''); } catch { /* Invalid legacy settings stay disabled. */ }
  const token = validToken(process.env.FACE_WORKER_TOKEN) ? process.env.FACE_WORKER_TOKEN : '';
  return { url, token, enabled: Boolean(url && token), arcface: process.env.FACE_WORKER_ARCFACE === '1', localOnly: false };
}

export function updateFaceWorker(previous, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Worker-Einstellungen ungültig.');
  for (const key of ['enabled', 'arcface', 'clearToken']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw Error('Worker-Einstellungen ungültig.');
  }
  const mode = input.mode ?? (input.url === undefined ? previous.mode ?? 'external' : 'external');
  if (!['local', 'external'].includes(mode) || mode === 'local' && input.clearToken) throw Error('Worker-Einstellungen ungültig.');
  if (mode === 'local') return { mode, url: previous.url, token: previous.token, enabled: input.enabled ?? previous.enabled, arcface: input.arcface ?? previous.arcface, localOnly: true };
  const url = input.url === undefined ? previous.url : normalizeUrl(input.url);
  if (input.token !== undefined && input.token !== '' && !validToken(input.token)) throw Error('Der Worker-Token braucht 32 bis 256 druckbare ASCII-Zeichen ohne Leerzeichen.');
  if (url && url !== previous.url && previous.token && !input.token && !input.clearToken) throw Error('Bei einer neuen Worker-Adresse bitte den zugehörigen Token eingeben.');
  const token = !url || input.clearToken ? '' : input.token || previous.token;
  const enabled = !input.clearToken && (input.enabled ?? previous.enabled);
  const arcface = !input.clearToken && (input.arcface ?? previous.arcface);
  if (enabled && (!url || !token)) throw Error('Worker-Adresse und Token eintragen, bevor die Verbindung freigegeben wird.');
  return { mode, url, token, enabled, arcface, localOnly: true };
}
