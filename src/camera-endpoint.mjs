import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function privateCameraIp(host) {
  if (isIP(host) === 6) return /^f[cd][0-9a-f]{2}:/i.test(host);
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split('.').map(Number);
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

export async function cameraUrl(value, protocols, resolver = lookup) {
  let url;
  try { url = new URL(value); } catch { throw Error('Kamera-Adresse ist ungültig.'); }
  if (typeof value !== 'string' || value.length > 2048 || !protocols.includes(url.protocol) || !url.hostname ||
      url.hash || /[\r\n\0]/.test(value)) throw Error('Kamera-Adresse ist ungültig.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let address = hostname;
  if (!isIP(hostname)) {
    let addresses, timer;
    try {
      addresses = await Promise.race([resolver(hostname, { all: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Zeitlimit')), 2500); })]);
    } catch { throw Error('Kamera-Adresse konnte nicht aufgelöst werden.'); }
    finally { clearTimeout(timer); }
    if (!addresses.length || !addresses.every(entry => privateCameraIp(entry.address))) {
      throw Error('Kamera-Adresse muss im privaten Netzwerk liegen.');
    }
    address = addresses.find(entry => entry.family === 4)?.address || addresses[0].address;
  }
  if (!privateCameraIp(address)) throw Error('Kamera-Adresse muss im privaten Netzwerk liegen.');
  url.hostname = isIP(address) === 6 ? '[' + address + ']' : address;
  if (!url.pathname) url.pathname = '/';
  return url;
}

export function cameraCredentials(username = '', password = '') {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 128 || password.length > 256 ||
      /[\r\n\0]/.test(username + password) || (!username && password)) throw Error('Kamera-Zugangsdaten sind ungültig.');
  return { username, password };
}
