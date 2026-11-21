import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createLocalServer } from '../src/server.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Android-Testpaket ist nur angemeldet über festen Pfad abrufbar; Status erkennt fehlende Pakete', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-distribution-')), storage = prepareStorage(root), artifactsRoot = join(root, 'artifacts');
  await mkdir(artifactsRoot); const apk = join(artifactsRoot, 'Tuerwache-Android-Test.apk'); await writeFile(apk, 'synthetic-apk-fixture');
  const accounts = new Accounts(root); await accounts.add({ name: 'Viewer', password: 'distribution-test-password', role: 'viewer' }, true);
  const service = { storage, cameras: [], events: [], state: () => ({ cameras: [], events: [] }) };
  const server = createLocalServer(service, { accounts, artifactsRoot }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await cleanTestDirectory(root); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/mobile/app', '/api/mobile/download/android']) assert.equal((await fetch(url + path)).status, 401);
  const login = await fetch(url + '/api/mobile/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tuerwache-app': '1' }, body: JSON.stringify({ name: 'Viewer', password: 'distribution-test-password', deviceName: 'Synthetic phone' }) });
  const { token } = await login.json(), headers = { authorization: `Bearer ${token}` };
  const info = await (await fetch(url + '/api/mobile/app', { headers })).json(); assert.equal(info.android.available, true); assert.equal(info.android.bytes, 21); assert.equal(info.ios.available, false); assert.equal(JSON.stringify(info).includes(artifactsRoot), false);
  const response = await fetch(url + info.android.downloadUrl, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/vnd.android.package-archive'); assert.match(response.headers.get('content-disposition'), /attachment; filename="Tuerwache-Android-Test.apk"/); assert.equal(await response.text(), 'synthetic-apk-fixture');
  const head = await fetch(url + info.android.downloadUrl, { headers, method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const partial = await fetch(url + info.android.downloadUrl, { headers: { ...headers, range: 'bytes=0-8' } }); assert.equal(partial.status, 206); assert.equal(await partial.text(), 'synthetic');
  await unlink(apk); assert.equal((await (await fetch(url + '/api/mobile/app', { headers })).json()).android.available, false); assert.equal((await fetch(url + info.android.downloadUrl, { headers })).status, 404);
});
