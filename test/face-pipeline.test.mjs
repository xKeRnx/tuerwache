import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { Accounts } from '../src/accounts.mjs';
import { createLocalServer } from '../src/server.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Vorlagen-HTTP-API schützt Änderungen, verbirgt biometrische Vektoren und entfernt veraltete Namenshinweise', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-face-http-')); t.after(() => cleanTestDirectory(root));
  const service = new RingService(prepareStorage(root)); service.cameras = [{ id: 'door' }]; const features = new Features(service, resolve('.')); t.after(() => features.drain());
  features.ai.request = async () => ({ embedding: Array(128).fill(0.125) });
  const accounts = new Accounts(root); await accounts.add({ name: 'Admin', password: 'face-admin-password', role: 'admin' }, true); await accounts.add({ name: 'Viewer', password: 'face-viewer-password', role: 'viewer' });
  const server = createLocalServer(service, { accounts }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tuerwache-app': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const admin = await (await post('/api/mobile/login', { name: 'Admin', password: 'face-admin-password', deviceName: 'Synthetic admin' })).json(), viewer = await (await post('/api/mobile/login', { name: 'Viewer', password: 'face-viewer-password', deviceName: 'Synthetic viewer' })).json();
  const image = n => 'data:image/jpeg;base64,' + Buffer.from('synthetic-photo-' + n).toString('base64');
  assert.equal((await post('/api/faces/add', { name: 'Joscha', image: image(1) }, viewer.token)).status, 403);
  assert.equal((await post('/api/faces/add', { name: 'Joscha', image: image(1) }, admin.token)).status, 200);
  const person = features.ai.people[0]; assert.equal((await post('/api/faces/add', { personId: person.id, image: image(2) }, admin.token)).status, 200);
  const state = await (await fetch(origin + '/api/state', { headers: { authorization: `Bearer ${admin.token}` } })).json(); assert.equal(state.ai.people[0].templateCount, 2); assert.equal(JSON.stringify(state).includes('embedding'), false); assert.equal(JSON.stringify(state.ai).includes('hash'), false);
  service.events.push({ id: 'old', ai: { status: 'ready', names: ['Joscha'], samples: [{ faces: [{ name: 'Joscha', personId: person.id, identityConfirmed: true }] }] }, summary: { status: 'ready', text: 'Eine Person. Joscha.', sceneText: 'Eine Person.', identities: [{ personId: person.id, name: 'Joscha' }] } });
  const body = { personId: person.id, templateId: person.templates[0].id };
  assert.equal((await post('/api/faces/templates/remove', body, viewer.token)).status, 403); assert.equal((await post('/api/faces/templates/remove', body)).status, 401);
  assert.equal((await post('/api/faces/templates/remove', body, admin.token)).status, 200); assert.equal(person.templates.length, 1); assert.deepEqual(service.events.at(-1).ai.names, []); assert.equal(service.events.at(-1).summary.text, 'Eine Person.');
  assert.equal((await post('/api/faces/templates/remove', { personId: person.id, templateId: person.templates[0].id }, admin.token)).status, 400);
});

test('Echte Gesichtsanalyse bestätigt Namen vor der Beschreibung; VLM erhält weder Namen noch Gesichtsvorlagen', { skip: !process.env.TEST_AI }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-face-scene-')); t.after(() => cleanTestDirectory(root));
  const service = new RingService(prepareStorage(root)); service.cameras = [{ id: 'door', name: 'Synthetische Kamera' }]; const features = new Features(service, resolve('.')); t.after(() => features.drain());
  const entry = service.event('clip', service.cameras[0], 'Synthetic fixture', { cameraId: 'door', status: 'ready', clip: 'fixture.mp4', video: { width: 512, height: 512, durationSeconds: 1 } });
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-loop', '1', '-i', 'test/fixtures/face.jpg', '-t', '1', '-r', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', features.path(entry)], { windowsHide: true });
  const person = await features.ai.enroll({ name: 'Kameratest', image: 'data:image/jpeg;base64,' + (await readFile('test/fixtures/face.jpg')).toString('base64') });
  await features.settings.update({ summaries: { ollama: { enabled: true, model: 'vision-test' } } }); features.updateCamera('door', { monitoring: true, faceRecognition: true, summaryProvider: 'ollama' });
  await features.analyze(entry.id, { notify: false }); assert.deepEqual(entry.ai.names, ['Kameratest']); assert.ok(entry.ai.confirmedIdentities[0].frames >= 3);
  features.summaries.providers = { summarize: async (_provider, config, frames, prompt) => {
    assert.equal(prompt.includes('Kameratest'), false); assert.equal(JSON.stringify(config).includes('embedding'), false); assert.equal(JSON.stringify(frames).includes('Kameratest'), false);
    return { provider: 'ollama', model: config.model, text: 'Eine Person ist vor der Kamera sichtbar.' };
  } };
  await features.summaries.enqueue(entry.id, true); assert.equal(entry.summary.status, 'ready'); assert.equal(entry.summary.sceneText.includes('Kameratest'), false); assert.match(entry.summary.text, /Lokale Gesichtserkennung.*Kameratest/); assert.equal(entry.summary.identities[0].personId, person.id);
  features.summaries.providers.summarize = async () => ({ provider: 'ollama', model: 'vision-test', text: 'Kameratest geht zur Tür.' });
  await features.summaries.enqueue(entry.id, true); assert.equal(entry.summary.status, 'error'); assert.match(entry.summary.message, /Namensvermutung/);
  features.summaries.providers.summarize = async () => ({ provider: 'ollama', model: 'vision-test', text: 'Eine Person ist sichtbar.' });
  features.updateCamera('door', { faceRecognition: false }); await features.summaries.enqueue(entry.id, true); assert.deepEqual(entry.summary.identities, []); assert.equal(entry.summary.text.includes('Kameratest'), false);
});
