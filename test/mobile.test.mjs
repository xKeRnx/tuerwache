import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Accounts } from '../src/accounts.mjs';
import { MobileSessions } from '../src/mobile-sessions.mjs';
import { MobilePush } from '../src/mobile-push.mjs';
import { createLocalServer } from '../src/server.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Handy-Tokens überleben Neustart, bleiben gehasht und werden durch Passwort, Rolle und Widerruf ungültig', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-mobile-')); t.after(() => cleanTestDirectory(root));
  const accounts = new Accounts(root), admin = await accounts.add({ name: 'Admin', password: 'mobile-test-password', role: 'admin' }, true);
  const viewer = await accounts.add({ name: 'Viewer', password: 'mobile-viewer-password', role: 'viewer' });
  const sessions = new MobileSessions(root, accounts), issued = sessions.issue(viewer, 'Testhandy');
  const auth = `Bearer ${issued.token}`;
  assert.equal((await readFile(sessions.file, 'utf8')).includes(issued.token), false);
  assert.equal(new MobileSessions(root, new Accounts(root)).current(auth).name, 'Viewer');
  assert.equal(sessions.current('Bearer bad'), null);
  assert.throws(() => sessions.revoke(issued.deviceId, admin));
  await accounts.update({ id: viewer.id, password: 'changed-test-password' }); assert.equal(sessions.current(auth), null);
  const second = sessions.issue(viewer, 'Testhandy');
  await accounts.update({ id: viewer.id, role: 'operator' }); assert.equal(sessions.current(`Bearer ${second.token}`), null);
  const third = sessions.issue(viewer, 'Testhandy'); sessions.revoke(third.deviceId, viewer); assert.equal(sessions.current(`Bearer ${third.token}`), null);
});

test('Native HTTP-Anmeldung schützt Clips und Rechte ohne Browser-CSRF-Ausnahme für Cookies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-mobile-http-')), storage = prepareStorage(root);
  const accounts = new Accounts(root); await accounts.add({ name: 'Admin', password: 'mobile-test-password', role: 'admin' }, true);
  await accounts.add({ name: 'Viewer', password: 'mobile-viewer-password', role: 'viewer' });
  const clip = '11111111-1111-4111-8111-111111111111.mp4'; await writeFile(join(storage.clips, clip), 'private-video');
  const service = { storage, cameras: [{ id: 'door' }], events: [{ clip, status: 'ready' }], state: () => ({ cameras: [], events: [{ message: 'private' }] }) };
  const server = createLocalServer(service, { accounts }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await cleanTestDirectory(root); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const loginBody = { name: 'Viewer', password: 'mobile-viewer-password', deviceName: 'Synthetic Android' };
  const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tuerwache-app': '1', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/mobile/login', loginBody, { origin: url })).status, 403);
  const login = await post('/api/mobile/login', loginBody); assert.equal(login.status, 200); assert.equal(login.headers.get('set-cookie'), null);
  const issued = await login.json(), headers = { authorization: `Bearer ${issued.token}` };
  const state = await (await fetch(url + '/api/state', { headers })).json(); assert.equal(state.user.name, 'Viewer'); assert.equal(state.users, undefined);
  assert.equal((await fetch(url + '/clips/' + clip)).status, 401);
  const video = await fetch(url + '/clips/' + clip, { headers }); assert.equal(await video.text(), 'private-video');
  assert.equal((await post('/api/capture', { cameraId: 'door' }, headers)).status, 403);
  assert.equal((await post('/api/mobile/configure', { token: 'ExponentPushToken[synthetic12345]', subscriptions: { door: ['ding'] } }, headers)).status, 200);
  assert.equal((await post('/api/mobile/configure', { token: 'https://attacker.example', subscriptions: {} }, headers)).status, 400);
  const configured = await (await fetch(url + '/api/state', { headers })).json(); assert.equal(configured.mobile.devices[0].pushEnabled, true); assert.equal(JSON.stringify(configured).includes('synthetic12345'), false);
  assert.equal((await post('/api/mobile/logout', {}, headers)).status, 200);
  assert.equal((await fetch(url + '/clips/' + clip, { headers })).status, 401);
  assert.equal((await post('/api/mobile/revoke', { id: issued.deviceId })).status, 401);
});

test('Handy-Push bleibt pro Nutzer und Kamera getrennt, enthält keine privaten Bilder und beachtet Widerruf und Pause', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-mobile-push-')); t.after(() => cleanTestDirectory(root));
  const accounts = new Accounts(root), user = await accounts.add({ name: 'Admin', password: 'mobile-test-password', role: 'admin' }, true);
  const sessions = new MobileSessions(root, accounts), issued = sessions.issue(user, 'Synthetic iPhone'); const principal = sessions.current(`Bearer ${issued.token}`);
  sessions.configure(principal, { token: 'ExpoPushToken[synthetic123456]', subscriptions: { door: ['ding', 'summary'] } }, ['door', 'side']);
  let monitoring = true, result = { status: 'ok', id: 'local-test-ticket' }; const sent = [];
  const service = { features: { settings: { profile: () => ({ monitoring }) } } };
  const push = new MobilePush(service, sessions, async message => { sent.push(message); return result; });
  push.notify({ id: '1', cameraId: 'door', summary: { text: 'private description' }, ai: { names: ['private name'] } }, 'ding'); await push.tail;
  assert.equal(sent.length, 1); assert.equal(JSON.stringify(sent).includes('private'), false); assert.equal(sessions.list(user)[0].lastPush.status, 'accepted');
  push.notify({ id: '1', cameraId: 'door' }, 'ding'); push.notify({ id: '2', cameraId: 'side' }, 'ding'); await push.tail; assert.equal(sent.length, 1);
  monitoring = false; push.notify({ id: '3', cameraId: 'door' }, 'summary'); await push.tail; assert.equal(sent.length, 1);
  monitoring = true; result = { status: 'error', details: { error: 'DeviceNotRegistered' } };
  push.notify({ id: '4', cameraId: 'door' }, 'summary'); await push.tail; assert.equal(sessions.list(user)[0].pushEnabled, false);
  await push.drain();
});

test('Push receipts survive restart, unregister invalid devices and never resend messages',async t=>{
  const root=await mkdtemp(join(tmpdir(),'tuerwache-push-receipt-'));t.after(()=>cleanTestDirectory(root));
  const accounts=new Accounts(root),user=await accounts.add({name:'Admin',password:'synthetic-push-password',role:'admin'},true),sessions=new MobileSessions(root,accounts),issued=sessions.issue(user,'Test phone'),principal=sessions.current(`Bearer ${issued.token}`);
  sessions.configure(principal,{token:'ExpoPushToken[synthetic123456]',subscriptions:{door:['ding']}},['door']);let sends=0;
  const service={features:{settings:{profile:()=>({monitoring:true})}}},push=new MobilePush(service,sessions,async()=>{sends++;return {status:'ok',id:'synthetic-receipt'};});await push.test(principal);assert.equal(sends,1);await assert.rejects(push.test(principal),/Minute/);
  sessions.sessions[0].pushReceipts[0].at=Date.now()-1000000;sessions.save();const restarted=new MobileSessions(root,accounts),next=new MobilePush(service,restarted,async()=>{throw Error('Must not resend');});
  await next.checkReceipts(async ids=>{assert.deepEqual(ids,['synthetic-receipt']);return {'synthetic-receipt':{status:'error',details:{error:'DeviceNotRegistered'}}};});assert.equal(restarted.sessions[0].pushToken,undefined);assert.equal(restarted.sessions[0].pushReceipts.length,0);assert.equal(sends,1);
});
