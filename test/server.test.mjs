import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalServer } from '../src/server.mjs';
import { request as httpRequest } from 'node:http';
import { cleanTestDirectory } from './helpers.mjs';

test('Lokaler HTTP-Vertrag: Anmeldung geschützt, Dateien begrenzt, Clips suchbar', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tuerwache-http-'));
  const filename = '11111111-1111-4111-8111-111111111111.mp4';
  await writeFile(join(directory, filename), '0123456789');
  let logins = 0;
  const service = {
    storage: { clips: directory },
    events: [{ clip: filename, status: 'ready' }],
    state: () => ({ phase: 'disconnected', cameras: [], events: [] }),
    login: async () => { logins++; },
  };
  const server = createLocalServer(service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(url + path, options);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await cleanTestDirectory(directory); });
  const initial = await request('/api/state');
  assert.equal(initial.status, 200);
  assert.match(initial.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const state = await initial.json();
  assert.match(state.csrf, /^[a-f0-9]{64}$/);
  for (const page of ['/events', '/cameras', '/ai', '/discord', '/storage', '/faces', '/users', '/connection', '/mobile']) {
    const response = await request(page); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
  }
  assert.equal((await request('/unknown-page')).status, 404);

  await t.test('Fremde Webseiten und DNS-Rebinding dürfen nicht zugreifen', async () => {
    const rebindStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(url + '/api/state', { headers: { host: 'attacker.example:3210' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(rebindStatus, 403);
    assert.equal((await request('/api/state', { headers: { origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await request('/api/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const navigationStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(url + '/', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(navigationStatus, 200);
    const pageNavigationStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(url + '/cameras', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(pageNavigationStatus, 200);
    assert.equal((await request('/router.js', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  });
  await t.test('Anmeldung benötigt lokalen Token und gültiges JSON', async () => {
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'test@example.com', password: 'test-only' }) };
    assert.equal((await request('/api/login', options)).status, 403);
    options.headers['x-local-token'] = state.csrf;
    assert.equal((await request('/api/login', { ...options, body: 'null' })).status, 400);
    assert.equal((await request('/api/login', { ...options, body: '{' })).status, 400);
    assert.equal((await request('/api/login', { ...options, body: JSON.stringify({ email: 'x', password: 'x'.repeat(17000) }) })).status, 400);
    assert.equal(logins, 0);
    assert.equal((await request('/api/login', options)).status, 200);
    assert.equal(logins, 1);
  });
  await t.test('Sitzungsdatei und beliebige Pfade werden niemals ausgeliefert', async () => {
    for (const path of ['/data/session.json', '/src/server.mjs', '/package.json', '/clips/..%2Fsession.json']) assert.equal((await request(path)).status, 404);
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/app.js')).status, 200);
  });
  await t.test('Clips unterstützen Browser-Suche, Suffix-Bereiche und ungültige Bereiche', async () => {
    const part = await request(`/clips/${filename}`, { headers: { range: 'bytes=2-5' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await part.text(), '2345');
    assert.equal(await (await request(`/clips/${filename}`, { headers: { range: 'bytes=-3' } })).text(), '789');
    assert.equal((await request(`/clips/${filename}`, { headers: { range: 'bytes=100-' } })).status, 416);
    assert.equal((await request(`/clips/${filename}`, { headers: { range: 'bytes=-0' } })).status, 416);
    assert.equal((await request(`/clips/${filename}`, { method: 'HEAD' })).headers.get('content-length'), '10');
  });
});
