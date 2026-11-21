import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-for-homebridge';
import { Subject } from 'rxjs';
import { PushNotificationAction } from 'ring-client-api';
import { Accounts } from '../src/accounts.mjs';
import { Features } from '../src/features.mjs';
import { createLocalServer } from '../src/server.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { RingService } from '../src/ring-service.mjs';
import { MobileSessions } from '../src/mobile-sessions.mjs';
import { MobilePush } from '../src/mobile-push.mjs';
import { defaultQuietHours, isQuiet } from '../src/quiet-hours.mjs';
import { cleanTestDirectory } from './helpers.mjs';

const execute = promisify(execFile);

test('Standortrechte filtern alle Medienrouten und maskieren Export und Discord', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tuerwache-sites-'));
  const service = new RingService(prepareStorage(directory));
  service.cameras = [{ id: 1, name: 'Haustür', isOffline: false }, { id: 2, name: 'Garage', isOffline: false }];
  service.phase = 'connected';
  const features = new Features(service, resolve('.'));
  const accounts = new Accounts(directory);
  const admin = await accounts.add({ name: 'Chef', password: 'Test-Admin-Passwort', role: 'admin' }, true);
  const role = accounts.cameraAccess.saveRole({ name: 'Hausgemeinschaft', actions: ['events', 'clips', 'live', 'export'] });
  const guest = await accounts.add({ name: 'Gast', password: 'Test-Gast-Passwort', role: role.id });
  const server = createLocalServer(service, { accounts });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { service.close(); await features.drain(); await new Promise(done => server.close(done)); await cleanTestDirectory(directory); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = account => {
    const cookie = `tw_session=${accounts.session(account)}`;
    return { cookie, 'X-Local-Token': accounts.current(cookie).csrf, 'Content-Type': 'application/json' };
  };
  const adminHeaders = headers(admin), guestHeaders = headers(guest);
  const post = (route, body, headers = adminHeaders) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = (route, headers = guestHeaders) => fetch(base + route, { headers });
  const ids = [randomUUID(), randomUUID()];
  for (const [index, cameraId] of ['1', '2'].entries()) {
    const id = ids[index], clip = `${id}.mp4`;
    const at = new Date().toISOString();
    const camera = service.cameras[index].name;
    service.events.push({ id, type: 'clip', clip, status: 'ready', trigger: 'ding', at, cameraId, camera });
    service.event('ding', service.cameras[index], 'Es hat geklingelt.', { cameraId });
  }
  const site = accounts.cameraAccess.saveSite({ name: 'Zuhause' });
  assert.equal((await post('/api/sites/assign', { cameraId: '1', siteId: site.id })).status, 200);
  const roleScope = { restricted: true, sites: [site.id], cameras: [], rules: [{ scope: 'camera', id: '1', deny: ['export'], allow: ['capture'] }] };
  assert.equal((await post('/api/roles/save', { ...role, permissions: roleScope }, guestHeaders)).status, 403);
  assert.equal((await post('/api/roles/save', { ...role, permissions: roleScope })).status, 200);
  const byRole = await (await get('/api/state')).json();
  assert.deepEqual(byRole.cameras.map(camera => camera.id), ['1']);
  assert.equal(byRole.cameras[0].permissions.includes('capture'), true);
  assert.equal(byRole.cameras[0].permissions.includes('export'), false);
  assert.equal((await get(`/clips/${ids[1]}.mp4`)).status, 404);
  const exception = { restricted: false, sites: [], cameras: [], rules: [{ scope: 'camera', id: '2', allow: ['events', 'clips'], deny: [] }] };
  assert.equal((await post('/api/users/update', { id: guest.id, permissions: exception })).status, 200);
  const withException = await (await get('/api/state')).json();
  assert.deepEqual(withException.cameras.find(camera => camera.id === '2').permissions, ['events', 'clips']);
  assert.equal((await post('/api/roles/save', { ...role, permissions: { restricted: false, sites: [], cameras: [], rules: [] } })).status, 200);
  assert.equal((await post('/api/users/update', { id: guest.id, name: 'Nachbar', permissions: { restricted: true, sites: [site.id], cameras: [], rules: [{ scope: 'camera', id: '1', deny: ['export'], allow: [] }] } })).status, 200);
  const state = await (await get('/api/state')).json();
  assert.equal(state.user.name, 'Nachbar'); assert.equal(state.user.roleName, role.name);
  assert.deepEqual(state.cameras.map(camera => camera.id), ['1']);
  assert.equal(state.sites[0].cameras[0].lastEvent.type, 'ding');
  assert.equal(state.sites[0].cameras[0].permissions.includes('export'), false);
  assert.ok(!JSON.stringify(state).includes('Garage'));
  for (const route of ['/api/clips', '/api/timeline', '/api/visits']) assert.ok(!JSON.stringify(await (await get(route)).json()).includes('Garage'));
  for (const route of [`/clips/${ids[1]}.mp4`, `/api/clips/${ids[1]}/thumbnail`, `/api/clips/${ids[1]}/export`, `/api/events/${ids[1]}`]) assert.equal((await get(route)).status, 404);
  assert.equal((await post('/api/live/start', { cameraId: '2' }, guestHeaders)).status, 403);
  assert.equal((await post('/api/capture', { cameraId: '1' }, guestHeaders)).status, 403);
  assert.equal((await get(`/api/clips/${ids[0]}/export`)).status, 403);

  const path = join(directory, 'clips', `${ids[0]}.mp4`);
  await execute(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=white:s=160x96:r=10', '-f', 'lavfi', '-i', 'sine', '-t', '0.6', '-c:v', 'libx264', '-c:a', 'aac', path]);
  const original = await readFile(path);
  const profile = { monitoring: true, discordDingClip: true, privacyZones: [{ x: 0, y: 0, width: 50, height: 100 }] };
  assert.equal((await post('/api/camera-settings', { cameraId: '1', profile })).status, 200);
  assert.deepEqual(Buffer.from(await (await get(`/clips/${ids[0]}.mp4`)).arrayBuffer()), original);
  const exportResponse = await get(`/api/clips/${ids[0]}/export`, adminHeaders);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-disposition'), /attachment/);
  const masked = Buffer.from(await exportResponse.arrayBuffer());
  async function assertMask(bytes, label) {
    const target = join(directory, label + '.mp4'); await writeFile(target, bytes);
    const { stdout } = await execute(ffmpeg, ['-v', 'error', '-i', target, '-frames:v', '1', '-c:v', 'rawvideo', '-threads', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
    assert.ok(stdout[16 + 48 * 160] < 10); assert.ok(stdout[125 + 48 * 160] > 230);
  }
  await assertMask(masked, 'export');
  assert.deepEqual(await readFile(path), original);
  features.settings.value.discord = { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/test/test' };
  let attachment;
  features.discord.client = { send: async (_url, _text, file) => { attachment = file; return { status: 'sent' }; } };
  await features.discord.enqueue(service.events.find(entry => entry.id === ids[0]), 'clip');
  await assertMask(attachment.bytes, 'discord');

  const login = await fetch(base + '/api/mobile/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tuerwache-App': '1' }, body: JSON.stringify({ name: 'Nachbar', password: 'Test-Gast-Passwort', deviceName: 'Nativ' }) });
  assert.equal(login.status, 200);
  const native = { Authorization: `Bearer ${(await login.json()).token}` };
  assert.equal((await get(`/clips/${ids[1]}.mp4`, native)).status, 404);
  assert.equal((await post('/api/users/update', { id: guest.id, disabled: true })).status, 200);
  assert.equal((await get('/api/state', native)).status, 401);
  assert.equal((await post('/api/users/update', { id: admin.id, disabled: true })).status, 400);
});

test('Ring-Konten erneuern Sitzungen unabhängig, erkennen gemeinsame Kameras und trennen nur das gewählte Konto', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tuerwache-ring-accounts-'));
  const apis = new Map();
  const camera = (id, name) => ({ id, name, onNewNotification: new Subject(), subscribeToDingEvents() {}, subscribeToMotionEvents() {} });
  const first = camera(1, 'Haustür'), duplicate = camera(1, 'Haustür'), second = camera(2, 'Garage');
  const service = new RingService(prepareStorage(directory), {
    createLogin: ({ email }) => ({ promptFor2fa: email === 'second@example.test', async getCurrentAuth() { if (this.promptFor2fa) throw Error('2FA required'); return { refresh_token: 'first-token' }; }, async getAuth(code) { assert.equal(code, '123456'); return { refresh_token: 'second-token' }; }, clearTimeouts() {} }),
    createApi: ({ refreshToken }) => {
      const api = { onRefreshTokenUpdated: new Subject(), getLocations: async () => [{ id: 'home', name: 'Zuhause', cameras: refreshToken === 'first-token' ? [first] : [duplicate, second] }], disconnect() { this.closed = true; } };
      apis.set(refreshToken, api); return api;
    },
  });
  t.after(async () => { service.close(); await cleanTestDirectory(directory); });
  service.cameraAccess = new Accounts(directory).cameraAccess;
  const extra = service.ringAccounts.save({ name: 'Garage' });
  await service.login('first@example.test', 'x');
  await service.login('second@example.test', 'y', extra.id);
  assert.equal(service.ringAccounts.get(extra.id).phase, 'two-factor');
  assert.deepEqual(service.cameras.map(camera => camera.id), [1]);
  await service.verifyCode('123456', extra.id);
  assert.deepEqual(service.cameras.map(camera => camera.id), [1, 2]);
  assert.equal(service.cameraAccess.siteFor('1'), service.cameraAccess.siteFor('2'));
  const notified = [];
  service.onCameraEvent = (camera, type) => notified.push([camera.id, type]);
  const ding = { android_config: { category: PushNotificationAction.Ding }, data: { event: { ding: { id: 'shared-ring-event' } } } };
  first.onNewNotification.next(ding); duplicate.onNewNotification.next(ding);
  assert.deepEqual(notified, [[1, 'ding']]);
  apis.get('second-token').onRefreshTokenUpdated.next({ newRefreshToken: 'rotated-second-token' });
  assert.equal(service.ringAccounts.token(extra), 'rotated-second-token');
  assert.ok(!(await readFile(service.ringAccounts.file, 'utf8')).includes('rotated-second-token'));
  assert.equal(service.ringAccounts.token(service.ringAccounts.get()), 'first-token');
  await service.ringAccounts.logout(extra.id, true);
  assert.equal(apis.get('second-token').closed, true);
  assert.equal(apis.get('first-token').closed, undefined);
  assert.deepEqual(service.cameras.map(camera => camera.id), [1]);
  assert.equal(service.phase, 'connected');
});

test('Push beachtet Mitternacht, Klingelausnahme und Rechte zum Versandzeitpunkt', async t => {
  assert.equal(isQuiet({ ...defaultQuietHours, enabled: true }, 'clip', new Date('2026-11-21T00:30:00+01:00')), true);
  assert.equal(isQuiet({ ...defaultQuietHours, enabled: true }, 'clip', new Date('2026-11-21T07:00:00+01:00')), false);
  assert.equal(isQuiet({ ...defaultQuietHours, enabled: true }, 'ding', new Date('2026-11-21T00:30:00+01:00')), false);
  const directory = await mkdtemp(join(tmpdir(), 'tuerwache-quiet-'));
  t.after(() => cleanTestDirectory(directory));
  const accounts = new Accounts(directory);
  await accounts.add({ name: 'Chef', password: 'Test-Admin-Passwort', role: 'admin' }, true);
  const one = await accounts.add({ name: 'Gast', password: 'Test-Gast-Passwort', role: 'viewer' });
  const two = await accounts.add({ name: 'Person', password: 'Test-Gast-Passwort', role: 'viewer' });
  accounts.cameraAccess.observe([{ id: 1, name: 'Haustür' }]);
  const sessions = new MobileSessions(directory, accounts);
  for (const [index, user] of [one, two].entries()) {
    const { token } = sessions.issue(user, `Gerät ${index}`);
    sessions.configure(sessions.current(`Bearer ${token}`), { token: `ExpoPushToken[testtoken000${index}]`, subscriptions: { 1: ['ding'] } }, ['1']);
  }
  await accounts.update({ id: one.id, permissions: { restricted: true, cameras: [], sites: [], rules: [] } });
  const date = new Date();
  const clock = minutes => new Date(date.getTime() + minutes * 60000).toISOString().slice(11, 16);
  accounts.updateQuietHours(two, { enabled: true, start: clock(-5), end: clock(5), timeZone: 'UTC', allowDing: false });
  const sent = [];
  const push = new MobilePush({ features: { settings: { profile: () => ({ monitoring: true }) } } }, sessions, async body => sent.push(body));
  await push.notify({ id: randomUUID(), cameraId: '1' }, 'ding'); await push.drain();
  assert.deepEqual(sent, []);
});
