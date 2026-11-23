import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RingService } from './ring-service.mjs';
import { prepareStorage } from './storage.mjs';
import { Accounts, MfaRequiredError } from './accounts.mjs';
import { Features } from './features.mjs';
import { readFileSync } from 'node:fs';
import { MobileSessions } from './mobile-sessions.mjs';
import { MobilePush } from './mobile-push.mjs';
import { MobileDistribution } from './mobile-distribution.mjs';
import { LiveVideo } from './live.mjs';
import { clipPage, ClipThumbnails } from './clip-archive.mjs';
import { AccessPolicy } from './access-policy.mjs';
import { timelinePage } from './timeline.mjs';
import { RequestLimits } from './request-limits.mjs';
import { operationsPost } from './operations-api.mjs';
import { visitPage } from './visits.mjs';
import { cameraActions } from './camera-access.mjs';
import { prepareClipCopy } from './privacy-zones.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selfActions = new Set(['/api/account/mfa/disable', '/api/account/mfa/start', '/api/account/mfa/confirm', '/api/account/quiet-hours', '/api/mobile/configure', '/api/mobile/revoke', '/api/mobile/logout', '/api/live/stop', '/api/mobile/test']);
const cameraRequests = new Map([
  ['/api/live/start', ['live', 'cameraId']], ['/api/capture', ['capture', 'cameraId']],
  ['/api/analyze', ['analyze', 'id']], ['/api/summarize', ['analyze', 'id']], ['/api/clips/protect', ['protect', 'id']],
  ['/api/quality/review', ['review', 'id']], ['/api/delete', ['delete', 'id']],
  ['/api/camera-settings', ['configure', 'cameraId']], ['/api/diagnose', ['configure', 'cameraId']], ['/api/automatic', ['configure', 'cameraId']],
]);
const staticFiles = new Map([
  ['/docs', ['docs.html', 'text/html; charset=utf-8']],
  ['/docs/', ['docs.html', 'text/html; charset=utf-8']],
  ['/docs.js', ['docs.js', 'text/javascript; charset=utf-8']],
  ['/docs.css', ['docs.css', 'text/css; charset=utf-8']],
  ['/license.txt', ['license.txt', 'text/plain; charset=utf-8']],
  ['/docs-media/onvif-search.webp', ['docs-media/onvif-search.webp', 'image/webp']],
  ['/docs-media/rtsp-setup.webp', ['docs-media/rtsp-setup.webp', 'image/webp']],
  ['/docs-media/onvif-search-en.webp', ['docs-media/onvif-search-en.webp', 'image/webp']],
  ['/docs-media/rtsp-setup-en.webp', ['docs-media/rtsp-setup-en.webp', 'image/webp']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
  ['/settings.css', ['settings.css', 'text/css; charset=utf-8']],
  ['/settings.js', ['settings.js', 'text/javascript; charset=utf-8']],
  ['/network-cameras.js', ['network-cameras.js', 'text/javascript; charset=utf-8']],
  ['/management.js', ['management.js', 'text/javascript; charset=utf-8']],
  ['/router.js', ['router.js', 'text/javascript; charset=utf-8']],
  ['/pages.css', ['pages.css', 'text/css; charset=utf-8']],
  ['/hls.min.js', ['hls.min.js', 'text/javascript; charset=utf-8']],
  ['/live.js', ['live.js', 'text/javascript; charset=utf-8']],
  ['/design.css', ['design.css', 'text/css; charset=utf-8']],
  ['/design.js', ['design.js', 'text/javascript; charset=utf-8']],
  ['/clips.js', ['clips.js', 'text/javascript; charset=utf-8']],
  ['/clips', ['index.html', 'text/html; charset=utf-8']],
  ['/access', ['index.html', 'text/html; charset=utf-8']],
  ['/access.js', ['access.js', 'text/javascript; charset=utf-8']],
  ['/face-library.js', ['face-library.js', 'text/javascript; charset=utf-8']],
  ['/face-suggestions.js', ['face-suggestions.js', 'text/javascript; charset=utf-8']],
  ['/timeline', ['index.html', 'text/html; charset=utf-8']],
  ['/timeline.js', ['timeline.js', 'text/javascript; charset=utf-8']],
  ['/providers.js', ['providers.js', 'text/javascript; charset=utf-8']],
  ['/mobile-info.js', ['mobile-info.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/translations.js', ['translations.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
]);
for (const page of ['/events', '/cameras', '/ai', '/discord', '/storage', '/faces', '/users', '/connection', '/mobile','/operations','/operations/storage','/operations/backups','/ai-review','/visits','/sites']) staticFiles.set(page, ['index.html', 'text/html; charset=utf-8']);
staticFiles.set('/operations.js',['operations.js','text/javascript; charset=utf-8']);
staticFiles.set('/operations.css',['operations.css','text/css; charset=utf-8']);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit = 16384) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('JSON-Anfrage erforderlich.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Anfrage zu groß.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Ungültige JSON-Anfrage.'); }
}

function text(value, max = 512) { return typeof value === 'string' && value.length > 0 && value.length <= max; }

async function streamFile(request, response, path, type) {
  const info = await stat(path);
  const range = request.headers.range;
  let start = 0, end = info.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else start = Number(match[1]);
    if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return;
    }
  }
  response.writeHead(range ? 206 : 200, {
    'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
  });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(path, { start, end });
  stream.once('error', () => response.destroy());
  response.once('close', () => stream.destroy());
  stream.pipe(response);
}

export function createLocalServer(service, { port = 3210, publicRoot = join(root, 'public'), clipsRoot = service.storage.clips, artifactsRoot = join(root, 'artifacts'), accounts, tls, allowedHosts = [], publicOrigin='', trustedProxies=[] } = {}) {
  const csrf = randomBytes(32).toString('hex');
  const limits=new RequestLimits();
  const thumbnails = new ClipThumbnails(service);
  const mobile = accounts ? new MobileSessions(dirname(accounts.file), accounts) : null;
  const distribution = new MobileDistribution(artifactsRoot);
  const access=accounts?new AccessPolicy(dirname(accounts.file),accounts,{tls,allowedHosts,publicOrigin,trustedProxies}):null;
  const cameraAccess = accounts?.cameraAccess;
  service.cameraAccess = cameraAccess;
  cameraAccess?.observe(service.cameras || [], service.events || []);
  if (accounts && service.features) {
    service.mobilePush = new MobilePush(service, mobile);
    new LiveVideo(service, (user, cameraId) => accounts.permits(user, 'live', cameraId) && (user.mobileId ? Boolean(mobile.sessions.find(item => item.id === user.mobileId && mobile.valid(item))) : Boolean(accounts.current(`tw_session=${user.token}`))));
  }
  const handler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Resource-Policy','same-origin');
    let context;
    try{context=access?.context(request)||{secure:Boolean(request.socket.encrypted),remote:false,address:request.socket.remoteAddress,origin:`${request.socket.encrypted?'https':'http'}://${request.headers.host}`};}
    catch{json(response,403,{error:'Nicht vertrauenswürdige Verbindung.'});return;}
    if(access&&!access.permits(context)){json(response,403,{error:'Externer Zugriff ist ausgeschaltet oder noch nicht vollständig eingerichtet.'});return;}
    if(context.secure)response.setHeader('Strict-Transport-Security','max-age=31536000');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const hosts = new Set([`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`, ...allowedHosts]);
    if (!hosts.has(request.headers.host)) { json(response, 403, { error: 'Nur lokaler Zugriff erlaubt.' }); return; }
    const origin = context.origin;
    if (request.headers.origin && request.headers.origin !== origin) { json(response, 403, { error: 'Fremder Ursprung blockiert.' }); return; }
    const openingHomePage = request.method === 'GET' && ['index.html','docs.html'].includes(staticFiles.get(request.url.split('?')[0])?.[0]) && request.headers['sec-fetch-mode'] === 'navigate';
    if (request.headers['sec-fetch-site'] === 'cross-site' && !openingHomePage) { json(response, 403, { error: 'Fremder Ursprung blockiert.' }); return; }
    try {
      const url = new URL(request.url, origin);
      const bearer = request.headers.authorization !== undefined;
      const user = bearer ? mobile?.current(request.headers.authorization) : accounts?.current(request.headers.cookie);
      const admin = !accounts || user?.role === 'admin';
      const permits = (action, id) => !accounts || accounts.permits(user, action, id);
      const visible = entry => Boolean(entry && (entry.cameraId || entry.camera || entry.clip ? permits(entry.clip ? 'clips' : 'events', entry.cameraId) : admin || permits('events')));
      const history = () => service.events.filter(visible).map(entry => {
        if (permits('clips', entry.cameraId) || !entry.recordingDecision?.clipId) return entry;
        const { clipId, ...recordingDecision } = entry.recordingDecision;
        return { ...entry, recordingDecision };
      });
      if((url.pathname.startsWith('/api/')||url.pathname.startsWith('/clips/')||url.pathname.startsWith('/live/'))&&!limits.allow(`${user?.id||'anonymous'}:${context.address}`,user?900:120)){response.setHeader('Retry-After','60');json(response,429,{error:'Zu viele Anfragen. Bitte eine Minute warten.'});return;}
      if (bearer && !user) { json(response, 401, { error: 'Handy-Anmeldung abgelaufen. Bitte erneut anmelden.' }); return; }
      const bootstrap = {appVersion:'0.13.2', setupRequired: accounts?.setupRequired ?? false, user: user ? { id: user.id, name: user.name, role: user.role, roleName: cameraAccess.role(user.role)?.name } : null, csrf: user?.csrf || csrf };
      if ((request.method === 'GET' || request.method === 'HEAD') && ['/api/mobile/app', '/api/mobile/download/android'].includes(url.pathname)) {
        if (!user) { json(response, 401, { error: 'Bitte in Türwache anmelden.' }); return; }
        const info = await distribution.info();
        if (url.pathname === '/api/mobile/app') { json(response, 200, info); return; }
        if (!info.android.available) { json(response, 404, { error: 'Noch kein Android-Testpaket auf diesem Server vorhanden.' }); return; }
        response.setHeader('Content-Disposition', 'attachment; filename="Tuerwache-Android-Test.apk"');
        await streamFile(request, response, distribution.apk, 'application/vnd.android.package-archive'); return;
      }
      if(request.method==='GET'&&/^\/api\/events\/[a-f0-9-]{36}$/.test(url.pathname)){
        if(accounts&&!user){json(response,401,{error:'Bitte anmelden.'});return;}
        const id=url.pathname.split('/').at(-1),entry=service.events.find(event=>event.id===id);
        if(!visible(entry)){json(response,404,{error:'Ereignis nicht mehr verfügbar.'});return;}
        const {directory,...event}=history().find(item=>item.id===id);json(response,200,{event});return;
      }
      if(request.method==='GET'&&url.pathname==='/api/visits'){
        if(accounts&&!user){json(response,401,{error:'Bitte anmelden.'});return;}
        json(response,200,{items:visitPage(history(),{cameraId:url.searchParams.get('cameraId')||''})});return;
      }
      const userPermissions = /^\/api\/users\/([a-f0-9-]{36})\/permissions$/.exec(url.pathname);
      if (request.method === 'GET' && userPermissions) {
        if (!accounts || !user || !admin) { json(response, user ? 403 : 401, { error: 'Nur für die Administration.' }); return; }
        const account = accounts.users.find(item => item.id === userPermissions[1]);
        if (!account) { json(response, 404, { error: 'Benutzer nicht gefunden.' }); return; }
        json(response, 200, { sites: cameraAccess.dashboard([], account) }); return;
      }
      if((request.method==='GET'||request.method==='HEAD')&&(url.pathname==='/api/backups'||url.pathname.startsWith('/api/backups/download/'))){
        if(accounts&&user?.role!=='admin'){json(response,user?403:401,{error:'Nur für die Administration.'});return;}
        if(url.pathname==='/api/backups'){json(response,200,{items:await service.features.operations.backups.list()});return;}
        const id=/^\/api\/backups\/download\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
        if(!id)throw Error('Sicherung nicht gefunden.');
        response.setHeader('Content-Disposition','attachment; filename="tuerwache-'+id+'.twbackup"');
        await streamFile(request,response,service.features.operations.backups.path(id),'application/octet-stream');return;
      }
      if(request.method==='GET'&&url.pathname==='/api/timeline'){
        if(accounts&&!user){json(response,401,{error:'Bitte in Türwache anmelden.'});return;}
        json(response,200,timelinePage(history(),{cameraId:url.searchParams.get('cameraId')||'',from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',kind:url.searchParams.get('kind')||'',cursor:url.searchParams.get('cursor')||'',limit:Number(url.searchParams.get('limit')||48)}));return;
      }
      if(request.method==='GET'&&url.pathname.startsWith('/api/faces/suggestions/')){
        if(accounts&&user?.role!=='admin'){json(response,403,{error:'Gesichter verwaltet nur die Administration.'});return;}
        const id=/^\/api\/faces\/suggestions\/([a-f0-9]{64})\/image$/.exec(url.pathname)?.[1];if(!id)throw new Error('Gesicht nicht gefunden.');
        const queue=service.features.faceSuggestions,bytes=await queue.image(queue.candidate(id));response.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length});response.end(bytes);return;
      }
      const exportMatch = /^\/api\/clips\/([a-f0-9-]{36})\/export$/.exec(url.pathname);
      if (exportMatch && ['GET', 'HEAD'].includes(request.method)) {
        if (accounts && !user) { json(response, 401, { error: 'Bitte anmelden.' }); return; }
        const entry = service.events.find(item => item.id === exportMatch[1] && item.clip && item.status === 'ready');
        if (!visible(entry)) { json(response, 404, { error: 'Clip nicht gefunden.' }); return; }
        if (!permits('export', entry.cameraId)) { json(response, 403, { error: 'Export ist für diese Kamera nicht freigegeben.' }); return; }
        const zones = service.features?.settings.profile(entry.cameraId).privacyZones || [];
        const abort = new AbortController();
        response.once('close', () => abort.abort());
        const copy = await prepareClipCopy(service.features || { path: () => join(clipsRoot, entry.clip) }, entry, zones, abort.signal);
        if (response.destroyed) { await copy.close(); return; }
        const release = () => copy.close().catch(() => {});
        response.once('close', release);
        if (!permits('clips', entry.cameraId) || !permits('export', entry.cameraId) || JSON.stringify(zones) !== JSON.stringify(service.features?.settings.profile(entry.cameraId).privacyZones || [])) {
          json(response, 409, { error: 'Freigabe oder Privatzonen geändert. Export erneut starten.' }); return;
        }
        response.setHeader('Content-Disposition', `attachment; filename="tuerwache-${exportMatch[1]}.mp4"`);
        await streamFile(request, response, copy.path, 'video/mp4'); return;
      }
      if(request.method==='GET'&&(url.pathname==='/api/clips'||/^\/api\/clips\/[^/]+\/thumbnail$/.test(url.pathname))){
        if(accounts&&!user){json(response,401,{error:'Bitte in Türwache anmelden.'});return;}
        if(url.pathname==='/api/clips'){json(response,200,clipPage(history(),{cursor:url.searchParams.get('cursor')||'',limit:Number(url.searchParams.get('limit')||24),cameraId:url.searchParams.get('cameraId')||''}));return;}
        const id=/^\/api\/clips\/([a-f0-9-]{36})\/thumbnail$/.exec(url.pathname)?.[1];if(!id)throw new Error('Clip nicht gefunden.');
        if(!visible(service.events.find(event=>event.id===id))){json(response,404,{error:'Clip nicht gefunden.'});return;}
        const bytes=await thumbnails.get(id);response.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length});response.end(bytes);return;
      }
      if (request.method === 'POST' && url.pathname === '/api/mobile/login') {
        if (!mobile || request.headers['x-tuerwache-app'] !== '1' || request.headers.origin || request.headers.cookie) { json(response, 403, { error: 'Native App-Anmeldung erforderlich.' }); return; }
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ungültige Anfrage.');
        const account = await accounts.login(body.name, body.password, context.address, body.otp);
        json(response, 200, mobile.issue(account, body.deviceName)); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        if (accounts && !user) { json(response, 200, bootstrap); return; }
        const state = { ...service.state(), ...service.features?.state(admin) };
        cameraAccess?.observe(state.cameras || []);
        state.sites = cameraAccess?.dashboard(state.cameras || [], accounts.principal(user.id)) || [];
        state.permissions = cameraActions.filter(action => permits(action));
        state.cameras = (state.cameras || []).map(camera => ({ ...camera, siteId: cameraAccess?.siteFor(camera.id), permissions: cameraActions.filter(action => permits(action, camera.id)) })).filter(camera => camera.permissions.length);
        if (!admin) {
          const safeHistory = history();
          state.events = safeHistory.slice(0, 100).map(({ directory, ...entry }) => entry);
          state.clipCount = safeHistory.filter(entry => entry.clip && entry.status === 'ready').length;
          state.recordings = state.recordings?.filter(job => permits('clips', job.cameraId));
          if (state.recording && !permits('clips', state.recording.cameraId)) state.recording = null;
          if (state.autoCameraId && !permits('configure', state.autoCameraId)) state.autoCameraId = null;
          const safeProfile = ({ sceneContext, privacyZones, ...profile }) => profile;
          state.cameras = state.cameras.map(camera => ({ ...camera, features: camera.features && safeProfile(camera.features) }));
          state.cameraProfiles = Object.fromEntries(Object.entries(state.cameraProfiles || {}).filter(([id]) => permits('analyze', id) || permits('configure', id)).map(([id, profile]) => [id, safeProfile(profile)]));
          delete state.media; delete state.diagnostics; delete state.pushTransport; delete state.hasSavedSession;
          if ('ringConnections' in state) delete state.ringConnections;
          state.message = state.phase === 'connected' ? 'Kameras verbunden.' : 'Keine aktive Kameraverbindung.';
        }
        const faceWorker = admin ? service.features?.settings.faceWorker() : null;
        const arcFaceModel = admin ? service.features?.managedFaceWorker?.arcFaceModel.status() : undefined;
        json(response, 200, { ...state, ...bootstrap, access:user?access?.state(user):undefined,quietHours:user?accounts.quietHours(user):undefined,mobile: mobile && user ? { devices: mobile.list(user), currentDeviceId: user.mobileId || null } : null, live: user ? service.live?.state(user) || null : null, ...(admin ? { users: accounts?.list() ?? [], roles: cameraAccess?.roles, cameraActions, networkCameras: service.networkCameras?.state() || [], faceWorkerConfigured: Boolean(faceWorker?.enabled), arcFaceConfigured: Boolean(faceWorker?.enabled && faceWorker.arcface), arcFaceModel } : {}) }); return;
      }
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        const authentication = ['/api/auth/setup', '/api/auth/login'].includes(url.pathname);
        if (accounts && !authentication && !user) { json(response, 401, { error: 'Bitte in Türwache anmelden.' }); return; }
        const scoped = cameraRequests.get(url.pathname);
        if (!admin && !authentication && url.pathname !== '/api/auth/logout' && !scoped && !selfActions.has(url.pathname)) { json(response, 403, { error: 'Für diese Aktion fehlen die Rechte.' }); return; }
        const supplied = Buffer.from(request.headers['x-local-token'] ?? '');
        const expected = authentication ? csrf : (user?.csrf || csrf);
        if (!bearer && (supplied.length !== expected.length || !timingSafeEqual(supplied, Buffer.from(expected)))) { json(response, 403, { error: 'Seite bitte neu laden.' }); return; }
        const body = await readBody(request, url.pathname === '/api/faces/add' ? 6_100_000 : 16384);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ungültige Anfrage.');
        if (!admin && scoped) {
          const [action, source] = scoped;
          const entry = source === 'id' ? service.events.find(event => event.id === body.id && event.clip) : null;
          const id = source === 'id' ? entry?.cameraId : body.cameraId;
          if ((source === 'id' ? !entry || !permits('clips', id) : typeof id !== 'string') || !permits(action, id)) { json(response, 403, { error: 'Für diese Kamera oder Aktion fehlen die Rechte.' }); return; }
        }
        if(['/api/operations/settings','/api/operations/check','/api/retention/preview','/api/retention/run','/api/backups/create','/api/backups/verify','/api/clips/protect','/api/quality/review','/api/quality/compare'].includes(url.pathname)){
          json(response,200,{ok:true,result:await operationsPost(service.features,url.pathname,body,user)});return;
        }
        switch (url.pathname) {
          case '/api/network-cameras/scan':
            if (!limits.allow('onvif-scan:' + user?.id, 8)) { json(response, 429, { error: 'Zu viele Netzwerksuchen.' }); return; }
            json(response, 200, { cameras: await service.networkCameras.scan() }); return;
          case '/api/network-cameras/profiles':
            if (!limits.allow('onvif-config:' + user?.id, 16)) { json(response, 429, { error: 'Zu viele Kameraabfragen.' }); return; }
            json(response, 200, { profiles: await service.networkCameras.profiles({ address: body.address, username: body.username, password: body.password }) }); return;
          case '/api/network-cameras/add': json(response, 201, { camera: await service.networkCameras.add(body) }); return;
          case '/api/network-cameras/update': json(response, 200, { camera: service.networkCameras.update(body.id, body) }); return;
          case '/api/network-cameras/remove': service.networkCameras.remove(body.id); break;
          case '/api/faces/suggestions/name': await service.features.faceSuggestions.enroll(body.id,body.name);break;
          case '/api/faces/suggestions/ignore': service.features.faceSuggestions.dismiss(body.id);break;
          case '/api/access/settings': access.update(body); break;
          case '/api/account/quiet-hours': accounts.updateQuietHours(user, body); break;
          case '/api/account/mfa/disable':
            if(context.remote||access.value.enabled)throw new Error('2FA nur lokal bei ausgeschaltetem Fernzugriff zurücksetzen.');
            await accounts.disableMfa(user,body.password,body.otp,context.address);response.setHeader('Set-Cookie','tw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');break;
          case '/api/account/mfa/start': json(response,200,await accounts.startMfa(user,body.password,context.address));return;
          case '/api/account/mfa/confirm': {
            const result=accounts.confirmMfa(user,body.otp);const token=accounts.session(result.user);
            response.setHeader('Set-Cookie',`tw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${context.secure?'; Secure':''}`);
            json(response,200,{ok:true,recoveryCodes:result.codes});return;
          }
          case '/api/mobile/test': await service.mobilePush.test(user); break;
          case '/api/mobile/configure':
            if (!user?.mobileId) throw new Error('Push direkt auf dem angemeldeten Handy einrichten.');
            mobile.configure(user, body, service.cameras.map(camera => String(camera.id)).filter(id => permits('push', id))); break;
          case '/api/mobile/revoke':
            mobile.revoke(body.id, user); await service.live?.stop(user); break;
          case '/api/mobile/logout':
            if (!user?.mobileId) throw new Error('Keine Handy-Anmeldung vorhanden.');
            mobile.revoke(user.mobileId, user); await service.live?.stop(user); break;
          case '/api/live/start':
            if (!user || !text(body.cameraId, 64) || !service.live) throw new Error('Livebild nicht verfügbar.');
            json(response, 200, { ok: true, live: await service.live.start(user, body.cameraId) }); return;
          case '/api/live/stop': await service.live?.stop(user); break;
          case '/api/auth/setup':
          case '/api/auth/login': {
            if (!accounts) throw new Error('Benutzerverwaltung nicht verfügbar.');
            const setup = url.pathname.endsWith('/setup');
            if (setup && context.remote) throw new Error('Erste Einrichtung direkt auf dem Server über localhost öffnen.');
            let account;
            try {
              account = setup ? await accounts.add({ ...body, role: 'admin' }, true) : await accounts.login(body.name, body.password, context.address, body.otp);
            } catch (error) {
              if (!(error instanceof MfaRequiredError)) throw error;
              json(response, 400, { error: error.message, code: 'MFA_REQUIRED' });
              return;
            }
            const token = accounts.session(account);
            response.setHeader('Set-Cookie', `tw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${context.secure ? '; Secure' : ''}`);
            break;
          }
          case '/api/auth/logout':
            await service.live?.stop(user);
            accounts?.end(user?.token);
            response.setHeader('Set-Cookie', 'tw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); break;
          case '/api/users/add': await accounts.add(body); break;
          case '/api/users/update': await accounts.update(body); break;
          case '/api/roles/save': cameraAccess.saveRole(body); break;
          case '/api/roles/remove': cameraAccess.removeRole(body.id, accounts.users); break;
          case '/api/sites/save': cameraAccess.saveSite(body); break;
          case '/api/sites/assign': cameraAccess.assign(body.cameraId, body.siteId); break;
          case '/api/settings':
            if (service.recording) throw new Error('Speicher-Einstellungen erst nach der Aufnahme ändern.');
            await service.features.settings.update(body); break;
          case '/api/camera-settings':
            if (!admin && Object.keys(body.profile || {}).some(key => !['monitoring', 'recordMotion', 'recordDing', 'recordingSeconds', 'recordingCooldownSeconds', 'extendRecording'].includes(key))) {
              json(response, 403, { error: 'Diese Kamera-Einstellungen sind der Administration vorbehalten.' }); return;
            }
            service.features.updateCamera(body.cameraId, body.profile); break;
          case '/api/discord/test': await service.features.discord.test(); break;
          case '/api/face-worker/save': await service.features.saveFaceWorker(body); break;
          case '/api/face-worker/download-arcface':
            service.features.managedFaceWorker.arcFaceModel.download();
            json(response, 202, { ok: true }); return;
          case '/api/face-worker/check': {
            if (!limits.allow('face-worker-check:' + user?.id, 8)) { json(response, 429, { error: 'Zu viele Worker-Prüfungen.' }); return; }
            await service.features.checkFaceWorker(body);
            break;
          }
          case '/api/discord/retry': service.features.discord.retry(body.id, body.kind)?.catch(() => {}); break;
          case '/api/models/save': { const id = service.features.settings.saveModel(body); if (service.features.summaries.providerStatus) delete service.features.summaries.providerStatus[id]; break; }
          case '/api/models/remove': service.features.settings.removeModel(body.id); break;
          case '/api/models/check': await service.features.summaries.checkModel(body.id); break;
          case '/api/providers/check': await service.features.summaries.checkProvider(body); break;
          case '/api/ollama/check': await service.features.summaries.checkOllama(body); break;
          case '/api/summarize': service.features.summaries.enqueue(body.id, true)?.catch(() => {}); break;
          case '/api/faces/add': await service.features.ai.enroll(body); break;
          case '/api/faces/templates/remove':
            service.features.ai.removeTemplate(body.personId, body.templateId); break;
          case '/api/faces/remove':
            if (service.features.ai.busy || [...service.features.jobs].some(key => key.startsWith('ai:'))) throw new Error('Gesichtsdaten erst nach laufender KI-Auswertung ändern.');
            service.features.ai.remove(body.id);
            service.features.faceSuggestions.forgetPerson(body.id);
            // The gallery-change callback removes historic automatic identity evidence.
            service.persistEvents(); break;
          case '/api/analyze': service.features.analyze(body.id, { notify: false }).catch(() => {}); break;
          case '/api/cloud/upload': service.features.upload(body.id).catch(() => {}); break;
          case '/api/login':
            if (!text(body.email, 254) || !text(body.password, 1024)) throw new Error('E-Mail und Passwort erforderlich.');
            await service.login(body.email.trim(), body.password, body.accountId); break;
          case '/api/code':
            if (!text(body.code, 12) || !/^\d{4,10}$/.test(body.code)) throw new Error('Bestätigungscode prüfen.');
            await service.verifyCode(body.code, body.accountId); break;
          case '/api/resume': await service.resume(body.accountId); break;
          case '/api/logout': await service.logout(body.accountId); break;
          case '/api/ring/accounts/save': json(response, 200, { ok: true, id: service.ringAccounts.save(body).id }); return;
          case '/api/ring/accounts/remove':
            if (body.id === 'primary' || !text(body.id, 64)) throw Error('Das Standardkonto kann abgemeldet werden.');
            await service.ringAccounts.logout(body.id, true); break;
          case '/api/capture':
            if (!text(body.cameraId, 64)) throw new Error('Kamera auswählen.');
            if (service.features && !service.features.settings.profile(body.cameraId).monitoring) throw new Error('Diese Kamera ist in Türwache pausiert.');
            // Reserve the capture synchronously, then return while it records.
            if (service.recordings?.has(body.cameraId) || service.recording?.cameraId===body.cameraId || service.phase !== 'connected' || !service.cameras.some(camera => String(camera.id) === body.cameraId && !camera.isOffline)) throw new Error('Kamera nicht bereit oder für diese Kamera läuft bereits eine Aufnahme.');
            service.capture(body.cameraId).catch(() => {}); break;
          case '/api/automatic':
            if (body.cameraId !== null && !text(body.cameraId, 64)) throw new Error('Kamera auswählen.');
            if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('Aufnahmeeinstellung ungültig.');
            service.setAutomatic(body.cameraId, body.enabled ?? true); break;
          case '/api/diagnose':
            if (!text(body.cameraId, 64)) throw new Error('Kamera auswählen.');
            await service.diagnose(body.cameraId); break;
          case '/api/delete':
            if (!text(body.id, 64)) throw new Error('Clip auswählen.');
            await service.deleteClip(body.id); break;
          default: json(response, 404, { error: 'Nicht gefunden.' }); return;
        }
        const live = service.live?.job;
        if (live && !service.live.validUser(live.user, live.cameraId)) await service.live.stop(undefined, live);
        json(response, 200, { ok: true }); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Methode nicht erlaubt.' }); return; }
      const asset = staticFiles.get(url.pathname);
      if (asset) { await streamFile(request, response, join(publicRoot, asset[0]), asset[1]); return; }
      const liveFile = /^\/live\/([a-f0-9-]{36})\/(index\.m3u8|segment\d{5}\.ts)$/.exec(url.pathname);
      if (liveFile && service.live) {
        const asset = await service.live.asset(liveFile[1], liveFile[2], url.searchParams.get('ticket'));
        response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': Buffer.byteLength(asset.body) }); response.end(request.method === 'HEAD' ? undefined : asset.body); return;
      }
      const clip = /^\/clips\/([a-f0-9-]{36}\.mp4)$/.exec(url.pathname);
      if (clip && accounts && !user) { json(response, 401, { error: 'Bitte in Türwache anmelden.' }); return; }
      if (clip && service.events.some(event => event.clip === clip[1] && event.status === 'ready')) {
        const entry = service.events.find(event => event.clip === clip[1] && event.status === 'ready');
        if (!visible(entry)) { json(response, 404, { error: 'Clip nicht gefunden.' }); return; }
        if(entry.local?.status==='deleted'&&entry.cloud?.status==='uploaded'){
          const remote=await service.features.cloud.open(service.features.settings.value.cloud,entry.cloud,request.headers.range);
          response.writeHead(remote.range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(remote.length!==undefined?{'Content-Length':remote.length}:{}),...(remote.range?{'Content-Range':remote.range}:{})});
          if(request.method==='HEAD'){remote.body?.destroy();remote.close();response.end();return;}
          response.once('close',()=>{remote.body.destroy();remote.close();});remote.body.once('error',()=>response.destroy());remote.body.pipe(response);return;
        }
        await streamFile(request, response, service.features ? service.features.path(entry) : join(clipsRoot, clip[1]), 'video/mp4'); return;
      }
      json(response, 404, { error: 'Nicht gefunden.' });
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const message = error.code ? 'Datei oder lokaler Speicher nicht verfügbar.' : error.message;
      json(response, 400, { error: message });
    }
  };
  const server=tls?createSecureServer({minVersion:'TLSv1.2',maxHeaderSize:16384,...tls},handler):createServer({maxHeaderSize:16384},handler);
  server.headersTimeout=10000;server.requestTimeout=30000;server.keepAliveTimeout=5000;server.maxHeadersCount=80;server.setTimeout(70000,socket=>socket.destroy());return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT muss zwischen 1024 und 65535 liegen.');
  const service = new RingService(prepareStorage(resolve(process.env.DATA_DIRECTORY||join(root, 'data'))));
  const features = new Features(service, root);
  const accounts = new Accounts(service.storage.root);
  const host = process.env.HOST || '127.0.0.1';
  const tls = process.env.TLS_CERT && process.env.TLS_KEY ? { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) } : undefined;
  const allowedHosts = (process.env.ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
  const publicOrigin=process.env.PUBLIC_ORIGIN||'',trustedProxies=(process.env.TRUSTED_PROXY_IPS||'').split(',').map(value=>value.trim()).filter(Boolean);
  if (host !== '127.0.0.1' && (!tls || !allowedHosts.length)) throw new Error('Direkter Netzwerkzugriff erfordert TLS_CERT, TLS_KEY und ALLOWED_HOSTS. Hinter einem Proxy HOST=127.0.0.1 verwenden.');
  const server = createLocalServer(service, { port, accounts, tls, allowedHosts,publicOrigin,trustedProxies });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} ist bereits belegt.` : 'Lokaler Server konnte nicht gestartet werden.'); process.exit(1); });
  server.listen(port, host, () => {
    console.log(`Türwache läuft: ${tls ? 'https' : 'http'}://127.0.0.1:${port}`);
    console.log('Ring-Zugangsdaten ausschließlich in der lokalen Oberfläche eingeben.');
    features.operations.start();
    features.startFaceWorker();
    service.networkCameras.start().catch(() => console.error('Der lokale Kamerapuffer konnte nicht vorbereitet werden.'));
    service.ringAccounts.resumeAll();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    service.close(); server.close();
    const deadline = setTimeout(() => process.exit(0), 245_000);
    Promise.allSettled([features.drain(), service.networkCameras.close()]).finally(() => {
      clearTimeout(deadline);
      setTimeout(() => process.exit(0), 1000).unref();
    });
  });
}
