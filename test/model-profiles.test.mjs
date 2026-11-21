import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { Settings } from '../src/settings.mjs';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { Accounts } from '../src/accounts.mjs';
import { createLocalServer } from '../src/server.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

async function storageFor(t) { const root = await mkdtemp(join(tmpdir(), 'tuerwache-models-')); t.after(() => cleanTestDirectory(root)); return prepareStorage(root); }
const modelInput = (name = 'Lokales Modell') => ({ name, provider: 'lmstudio', model: 'vision-test', baseUrl: 'http://127.0.0.1:1234/v1', enabled: true });

test('Mehrere Modelle desselben Anbieters bleiben getrennt, bearbeitbar und über Neustarts gespeichert; zugeordnete Modelle bleiben geschützt', async t => {
  const storage = await storageFor(t), settings = new Settings(storage); settings.registerCameras(['door', 'side']);
  await settings.update({ summaries: { ollama: { enabled: true, model: 'old-vision:test' } } }); settings.updateProfile('door', { summaryProvider: 'ollama' });
  const first = settings.saveModel({ ...modelInput('Schnell'), apiKey: 'first-secret' }), second = settings.saveModel({ ...modelInput('Genauer'), model: 'other-vision', apiKey: 'second-secret' });
  assert.notEqual(first, second); assert.equal(settings.summaryModels().length, 3); assert.equal(settings.profile('door').summaryProvider, 'ollama');
  settings.updateProfile('side', { summaryProvider: second });
  assert.throws(() => settings.removeModel(second), /noch einer Kamera/); assert.throws(() => settings.removeModel('ollama'), /noch einer Kamera/);
  settings.saveModel({ ...modelInput('Umbenannt'), id: first, model: 'updated-vision', apiKey: '' });
  const restored = new Settings(storage); assert.equal(restored.resolveSummary(first).name, 'Umbenannt'); assert.equal(restored.resolveSummary(first).model, 'updated-vision'); assert.equal(restored.resolveSummary(first).apiKey, 'first-secret'); assert.equal(restored.resolveSummary(second).apiKey, 'second-secret'); assert.equal(restored.profile('side').summaryProvider, second);
  assert.equal(JSON.stringify(restored.public()).includes('secret'), false); assert.equal(JSON.stringify(restored.summaryModels()).includes('secret'), false);
  restored.saveModel({ ...modelInput('Umbenannt'), id: first, clearKey: true }); assert.equal(restored.resolveSummary(first).apiKey, ''); assert.equal(restored.resolveSummary(first).enabled, false);
  restored.removeModel(first); assert.equal(new Settings(storage).resolveSummary(first), null);
  assert.throws(() => restored.saveModel({ ...modelInput(), id: '__proto__' })); assert.throws(() => restored.updateProfile('side', { summaryProvider: 'model_does_not_exist' }));
  await assert.rejects(restored.update({ summaries: { profiles: { injected: { apiKey: 'not-validated' } } } }));
});

test('Modell-Auswertung nutzt nur die ausgewählte Konfiguration; Änderung eines wartenden Modells verhindert eine veraltete Anfrage', async t => {
  const storage = await storageFor(t), service = new RingService(storage); service.cameras = [{ id: 'door', name: 'Test' }];
  const features = new Features(service, resolve('.')), settings = features.settings;
  settings.saveModel({ ...modelInput('Erstes'), apiKey: 'first-secret' }); const second = settings.saveModel({ ...modelInput('Zweites'), model: 'vision-two', apiKey: 'second-secret' });
  features.updateCamera('door', { monitoring: true, summaryProvider: second });
  const entry = service.event('clip', service.cameras[0], 'Synthetic test', { cameraId: 'door', status: 'ready', clip: 'fixture.mp4', video: { durationSeconds: 1 } });
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x120:r=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', features.path(entry)], { windowsHide: true });
  const calls = []; features.summaries.providers = { summarize: async (provider, config, frames) => { calls.push({ provider, config }); assert.equal(frames.length, 6); return { provider, model: config.model, text: 'Synthetischer Test.' }; } };
  await features.summaries.enqueue(entry.id, true); assert.equal(entry.summary.status, 'ready'); assert.equal(entry.summary.configurationId, second); assert.equal(calls[0].provider, 'lmstudio'); assert.equal(calls[0].config.apiKey, 'second-secret');
  let release; features.summaries.tail = new Promise(resolve => { release = resolve; });
  const queued = features.summaries.enqueue(entry.id, true); settings.saveModel({ ...modelInput('Zweites'), id: second, model: 'vision-three' }); release(); await queued;
  assert.equal(entry.summary.status, 'skipped'); assert.equal(calls.length, 1);
});

test('Modell-HTTP-Verwaltung verlangt Admin-Rechte und liefert keine gespeicherten API-Schlüssel zurück', async t => {
  const storage = await storageFor(t), service = new RingService(storage); service.cameras = [{ id: 'door', name: 'Test' }]; new Features(service, resolve('.'));
  const accounts = new Accounts(storage.root); await accounts.add({ name: 'Admin', password: 'models-admin-password', role: 'admin' }, true); await accounts.add({ name: 'Viewer', password: 'models-viewer-password', role: 'viewer' });
  const server = createLocalServer(service, { accounts }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tuerwache-app': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const admin = await (await post('/api/mobile/login', { name: 'Admin', password: 'models-admin-password', deviceName: 'Synthetic admin' })).json();
  const viewer = await (await post('/api/mobile/login', { name: 'Viewer', password: 'models-viewer-password', deviceName: 'Synthetic viewer' })).json();
  assert.equal((await post('/api/models/save', modelInput())).status, 401); assert.equal((await post('/api/models/save', modelInput(), viewer.token)).status, 403);
  assert.equal((await post('/api/models/save', { ...modelInput(), apiKey: 'http-secret' }, admin.token)).status, 200);
  const state = await (await fetch(origin + '/api/state', { headers: { authorization: `Bearer ${admin.token}` } })).json(); const item = state.summaryService.modelProfiles[0]; assert.equal(item.keySet, true); assert.equal(JSON.stringify(state).includes('http-secret'), false);
  const viewerState = await (await fetch(origin + '/api/state', { headers: { authorization: `Bearer ${viewer.token}` } })).json(); assert.equal(viewerState.summaryService.modelProfiles, undefined); assert.equal(viewerState.summaryService.modelChoices[0].name, item.name); assert.equal(JSON.stringify(viewerState).includes('http-secret'), false);
  assert.equal((await post('/api/models/remove', { id: item.id }, viewer.token)).status, 403);
  assert.equal((await post('/api/models/remove', { id: item.id }, admin.token)).status, 200); assert.equal(service.features.settings.summaryModels().length, 0);
});
