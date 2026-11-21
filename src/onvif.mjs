import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { request as http } from 'node:http';
import { request as https } from 'node:https';
import { SaxesParser } from 'saxes';
import { cameraCredentials, cameraUrl, privateCameraIp } from './camera-endpoint.mjs';

const device = 'http://www.onvif.org/ver10/device/wsdl';
const media = 'http://www.onvif.org/ver10/media/wsdl';
const media2 = 'http://www.onvif.org/ver20/media/wsdl';
const discovery = 'http://schemas.xmlsoap.org/ws/2005/04/discovery';
const xml = value => String(value).replace(/[<>&"']/g, character =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);

function tree(source) {
  const root = { children: [] }, stack = [root];
  const parser = new SaxesParser({ xmlns: true });
  let count = 0;
  parser.on('doctype', () => { throw Error('XML-Dokumenttyp ist nicht zulässig.'); });
  parser.on('opentag', tag => {
    if (++count > 2500 || stack.length > 30) throw Error('ONVIF-Antwort ist zu groß.');
    const node = { name: tag.local, attrs: tag.attributes, value: '', children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  });
  parser.on('closetag', () => stack.pop());
  parser.on('text', value => { stack.at(-1).value += value; });
  parser.on('cdata', value => { stack.at(-1).value += value; });
  parser.write(source).close();
  return root;
}
const children = (node, name) => node?.children.filter(child => child.name === name) || [];
const child = (node, name) => children(node, name)[0];
const value = (node, name) => child(node, name)?.value.trim() || '';
function find(node, name) {
  if (!node) return;
  if (node.name === name) return node;
  for (const next of node.children) {
    const result = find(next, name);
    if (result) return result;
  }
}

export function discoveryMatch(datagram, sender, messageId) {
  if (!privateCameraIp(sender) || datagram.length > 32_768) return [];
  try {
    const document = tree(datagram.toString('utf8'));
    if (find(document, 'RelatesTo')?.value.trim() !== messageId) return [];
    return children(find(document, 'ProbeMatches'), 'ProbeMatch').flatMap(match => {
      const address = value(match, 'XAddrs').split(/\s+/).find(text => /^https?:\/\//i.test(text));
      if (!address) return [];
      const url = new URL(address);
      if (url.username || url.password || url.hash) return [];
      url.hostname = sender;
      const scope = value(match, 'Scopes').match(/onvif:\/\/www\.onvif\.org\/name\/([^\s]+)/)?.[1];
      let name = sender;
      if (scope) {
        try { name = decodeURIComponent(scope).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || sender; } catch {}
      }
      return [{ name, address: url.href }];
    });
  } catch { return []; }
}

export async function discoverOnvif() {
  const addresses = Object.values(networkInterfaces()).flat().filter(item =>
    !item.internal && item.family === 'IPv4' && privateCameraIp(item.address));
  const found = new Map();
  await Promise.all(addresses.map(({ address }) => new Promise(resolve => {
    const socket = createSocket('udp4');
    const messageId = 'urn:uuid:' + randomUUID();
    const probe = Buffer.from(`<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
      xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="${discovery}"
      xmlns:n="http://www.onvif.org/ver10/network/wsdl"><s:Header><a:MessageID>${messageId}</a:MessageID>
      <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To><a:Action>${discovery}/Probe</a:Action>
      </s:Header><s:Body><d:Probe><d:Types>n:NetworkVideoTransmitter</d:Types></d:Probe></s:Body></s:Envelope>`);
    const timer = setTimeout(finish, 2400);
    function finish() {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve();
    }
    function send() { socket.send(probe, 3702, '239.255.255.250', error => { if (error) finish(); }); }
    socket.on('error', finish);
    socket.on('message', (data, remote) => {
      for (const match of discoveryMatch(data, remote.address, messageId)) {
        if (found.size < 32) found.set(match.address, match);
      }
    });
    socket.bind(0, address, () => {
      try { socket.setMulticastInterface(address); socket.setMulticastTTL(1); send(); }
      catch { finish(); }
    });
  })));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const wsse = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const wsu = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
function security({ username, password }) {
  if (!username) return '';
  const nonce = randomBytes(20), date = new Date().toISOString();
  const fingerprint = createHash('sha1').update(nonce).update(date).update(password).digest('base64');
  return `<o:Security xmlns:o="${wsse}" xmlns:u="${wsu}"><o:UsernameToken><o:Username>${xml(username)}</o:Username>
    <o:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${fingerprint}</o:Password>
    <o:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</o:Nonce>
    <u:Created>${date}</u:Created></o:UsernameToken></o:Security>`;
}

function digestAuth(challenge, url, { username, password }) {
  if (!username || typeof challenge !== 'string' || !/^Digest /i.test(challenge)) return;
  const fields = Object.fromEntries([...challenge.matchAll(/([a-z]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/gi)]
    .map(([, key, quoted, plain]) => [key.toLowerCase(), quoted ?? plain]));
  const algorithm = (fields.algorithm || 'MD5').toUpperCase();
  if (!['MD5', 'SHA-256'].includes(algorithm) || !fields.realm || !fields.nonce ||
      fields.qop && !fields.qop.split(',').map(item => item.trim()).includes('auth')) return;
  const hash = text => createHash(algorithm.replace('-', '').toLowerCase()).update(text).digest('hex');
  const uri = url.pathname + url.search, cnonce = randomBytes(16).toString('hex'), nc = '00000001';
  const a1 = hash(username + ':' + fields.realm + ':' + password), a2 = hash('POST:' + uri);
  const response = hash(fields.qop ? [a1, fields.nonce, nc, cnonce, 'auth', a2].join(':') : [a1, fields.nonce, a2].join(':'));
  const quoted = Object.entries({ username, realm: fields.realm, nonce: fields.nonce, uri, response,
    ...(fields.opaque ? { opaque: fields.opaque } : {}), ...(fields.qop ? { cnonce } : {}) });
  const quote = text => '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
  return 'Digest ' + quoted.map(([key, val]) => key + '=' + quote(val)).join(', ') + ', algorithm=' + algorithm +
    (fields.qop ? ', qop=auth, nc=' + nc : '');
}

async function soap(endpoint, namespace, operation, body, credentials) {
  const message = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:m="${namespace}"
    xmlns:t="http://www.onvif.org/ver10/schema"><s:Header>${security(credentials)}</s:Header>
    <s:Body><m:${operation}>${body}</m:${operation}></s:Body></s:Envelope>`;
  const send = authorization => new Promise((resolve, reject) => {
    const request = endpoint.protocol === 'https:' ? https : http;
    const outgoing = request(endpoint, { method: 'POST', agent: false, signal: AbortSignal.timeout(4000), headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${namespace}/${operation}"`,
      'Content-Length': Buffer.byteLength(message), ...(authorization ? { Authorization: authorization } : {}),
    } }, incoming => {
      const chunks = [];
      let bytes = 0;
      incoming.on('data', chunk => {
        if ((bytes += chunk.length) > 512_000) { outgoing.destroy(Error('ONVIF-Antwort ist zu groß.')); return; }
        chunks.push(chunk);
      });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode, challenge: incoming.headers['www-authenticate'],
        body: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('error', reject);
    outgoing.end(message);
  });
  let result = await send();
  const authorization = result.status === 401 && digestAuth(result.challenge, endpoint, credentials);
  if (authorization) result = await send(authorization);
  if (result.status !== 200) throw Error('ONVIF-Anfrage fehlgeschlagen.');
  const parsed = tree(result.body);
  if (find(parsed, 'Fault')) throw Error('Die Kamera hat die ONVIF-Anfrage abgelehnt.');
  return find(parsed, operation + 'Response');
}

function sameCamera(address, endpoint, protocols) {
  const url = new URL(address, endpoint);
  if (!protocols.includes(url.protocol) || url.hash) throw Error('Kamera-Dienstadresse ist ungültig.');
  url.hostname = endpoint.hostname;
  url.username = url.password = '';
  return url;
}

export async function onvifMedia({ address, username, password, profile }, get = soap) {
  const credentials = cameraCredentials(username, password);
  const endpoint = await cameraUrl(address, ['http:', 'https:']);
  if (endpoint.username || endpoint.password) throw Error('ONVIF-Zugangsdaten in die separaten Felder eingeben.');
  const services = [];
  const available = await get(endpoint, device, 'GetServices', '<m:IncludeCapability>false</m:IncludeCapability>', credentials).catch(() => null);
  for (const item of children(available, 'Service')) {
    const namespace = value(item, 'Namespace'), url = value(item, 'XAddr');
    if (url && [media, media2].includes(namespace)) services.push({ namespace, url });
  }
  if (!services.length) {
    const caps = await get(endpoint, device, 'GetCapabilities', '<m:Category>Media</m:Category>', credentials).catch(() => null);
    const url = value(find(caps, 'Media'), 'XAddr');
    if (url) services.push({ namespace: media, url });
  }
  const profiles = new Map();
  for (const { namespace, url } of services.slice(0, 4)) {
    const target = sameCamera(url, endpoint, ['http:', 'https:']);
    const response = await get(target, namespace, 'GetProfiles', '', credentials).catch(() => null);
    for (const item of children(response, 'Profiles').slice(0, 24)) {
      const token = item.attrs.token?.value;
      if (token && token.length <= 128 && !profiles.has(token)) {
        const encoder = find(item, 'VideoEncoderConfiguration') || find(item, 'VideoEncoder');
        profiles.set(token, { token, name: value(item, 'Name').slice(0, 100) || token,
          encoding: value(encoder, 'Encoding'), namespace, target });
      }
    }
  }
  if (!profiles.size) throw Error('Keine ONVIF-Videoprofile gefunden. ONVIF-Konto, Adresse und Uhrzeit der Kamera prüfen.');
  if (profile === undefined) return [...profiles.values()].map(({ token, name, encoding }) => ({ token, name, encoding }));
  const selected = profiles.get(profile);
  if (!selected) throw Error('Das ONVIF-Videoprofil ist nicht mehr verfügbar.');
  const body = selected.namespace === media2 ? '<m:Protocol>RTSP</m:Protocol>' :
    '<m:StreamSetup><t:Stream>RTP-Unicast</t:Stream><t:Transport><t:Protocol>RTSP</t:Protocol></t:Transport></m:StreamSetup>';
  const response = await get(selected.target, selected.namespace, 'GetStreamUri', body + '<m:ProfileToken>' + xml(profile) + '</m:ProfileToken>', credentials);
  const addressOfStream = find(response, 'Uri')?.value.trim();
  if (!addressOfStream) throw Error('Die Kamera hat keine RTSP-Adresse geliefert.');
  const stream = sameCamera(addressOfStream, endpoint, ['rtsp:', 'rtsps:']);
  stream.username = credentials.username;
  stream.password = credentials.password;
  return stream.href;
}
