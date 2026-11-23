import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFaceWorker } from '../scripts/start-face-worker.mjs';
import { Accounts } from '../src/accounts.mjs';
import { Features } from '../src/features.mjs';
import { RingService } from '../src/ring-service.mjs';
import { createLocalServer } from '../src/server.mjs';
import { Settings } from '../src/settings.mjs';
import { prepareStorage, readJson } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Gesichts-Worker-Einstellungen bleiben nach dem Neustart erhalten und schützen gespeicherte Tokens', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-worker-settings-'));
  t.after(() => cleanTestDirectory(root));
  const storage = prepareStorage(root);
  const settings = new Settings(storage);
  const token = randomBytes(32).toString('hex');
  await settings.update({ faceWorker: { enabled: true, arcface: true, url: 'http://127.0.0.1:3211/', token } });
  const restored = new Settings(storage);
  assert.deepEqual(restored.faceWorker(), { mode: 'external', url: 'http://127.0.0.1:3211', token, enabled: true, arcface: true, localOnly: true });
  assert.equal(restored.public().faceWorker.tokenSet, true);
  assert.equal(JSON.stringify(restored.public()).includes(token), false);
  await assert.rejects(restored.update({ faceWorker: { url: 'https://ki.home.arpa:3211', token: '' } }), /neuen Worker-Adresse/);
  await assert.rejects(restored.update({ faceWorker: { url: 'http://192.168.1.10:3211', token } }), /HTTP ist nur auf localhost/);
  await restored.update({ faceWorker: { enabled: false, token: '' } });
  assert.equal(restored.faceWorker().token, token);
  assert.equal(restored.faceWorker().enabled, false);
  await restored.update({ faceWorker: { clearToken: true } });
  assert.equal(restored.public().faceWorker.tokenSet, false);
  assert.equal(JSON.stringify(readJson(restored.file, null)).includes(token), false);
});

test('Admin prüft und speichert den Worker über HTTP ohne Neustart, Benutzer ohne Admin-Rolle bleiben ausgeschlossen', { skip: !process.env.TEST_AI }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-worker-admin-'));
  const service = new RingService(prepareStorage(root));
  const features = new Features(service, resolve('.'));
  const accounts = new Accounts(root);
  const token = randomBytes(32).toString('hex');
  const probes = [];
  const worker = createFaceWorker({ run: async ({ model, images }) => {
    probes.push({ model, count: images.length });
    return { embeddings: images.map(() => [1, ...Array(model === 'sface-v1' ? 127 : 511).fill(0)]) };
  } }, token, undefined, { enableArcFace: true });
  const server = createLocalServer(service, { accounts });
  t.after(async () => {
    for (const instance of [server, worker]) {
      if (instance.listening) {
        instance.closeAllConnections();
        await new Promise(done => instance.close(done));
      }
    }
    await features.drain();
    await cleanTestDirectory(root);
  });
  await accounts.add({ name: 'WorkerAdmin', password: 'worker-test-admin-password', role: 'admin' }, true);
  await accounts.add({ name: 'WorkerViewer', password: 'worker-test-viewer-password', role: 'viewer' });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, session) => fetch(origin + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tuerwache-app': '1', ...(session && { authorization: `Bearer ${session}` }) },
    body: JSON.stringify(body),
  });
  const signin = async (name, password) => (await (await post('/api/mobile/login', { name, password, deviceName: 'Test' })).json()).token;
  const admin = await signin('WorkerAdmin', 'worker-test-admin-password');
  const viewer = await signin('WorkerViewer', 'worker-test-viewer-password');
  const config = { enabled: true, arcface: true, url: `http://localhost:${worker.address().port}`, token };
  assert.equal((await post('/api/face-worker/save', config, viewer)).status, 403);
  assert.equal((await post('/api/face-worker/check', config, viewer)).status, 403);
  assert.equal((await post('/api/face-worker/check', config, admin)).status, 200);
  assert.deepEqual(probes, [{ model: 'sface-v1', count: 1 }, { model: 'arcface-w600k-r50-v1', count: 1 }]);
  assert.equal(features.settings.value.faceWorker, undefined);
  assert.equal((await post('/api/face-worker/save', config, admin)).status, 200);
  assert.equal((await post('/api/face-worker/check', { token: '' }, admin)).status, 200);
  assert.equal((await post('/api/face-worker/check', { ...config, url: 'https://203.0.113.1:3211' }, admin)).status, 400);
  assert.equal(probes.length, 4);
  const state = await (await fetch(origin + '/api/state', { headers: { authorization: `Bearer ${admin}` } })).json();
  assert.equal(state.settings.faceWorker.tokenSet, true);
  assert.equal(state.faceWorkerConfigured, true);
  assert.equal(state.arcFaceConfigured, true);
  assert.equal(JSON.stringify(state).includes(token), false);
  const limited = await (await fetch(origin + '/api/state', { headers: { authorization: `Bearer ${viewer}` } })).json();
  assert.equal(limited.settings, undefined);
  assert.equal(limited.faceWorkerConfigured, undefined);
  const local = { mode: 'local', enabled: true, arcface: false };
  assert.equal((await post('/api/face-worker/save', local, admin)).status, 200);
  assert.equal((await post('/api/face-worker/check', local, admin)).status, 200);
  const managed = await features.managedFaceWorker.running;
  assert.equal(managed.server.address().address, '127.0.0.1');
  assert.equal(managed.ai.completedJobs, 1);
  assert.equal(probes.length, 4);
  const restored = new Settings(service.storage);
  assert.equal(restored.faceWorker().mode, 'local');
  assert.equal(restored.faceWorker().token, token);
  assert.equal(JSON.stringify(restored.public()).includes(managed.token), false);
});
