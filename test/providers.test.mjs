import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVIDERS } from '../src/provider-catalog.mjs';
import { SummaryProviders, normalizeProviderUrl } from '../src/summary-providers.mjs';
import { Settings } from '../src/settings.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Alle Anbieter speichern getrennte Schlüssel und Kamera-Auswahl ohne Geheimnisse in öffentlichen Einstellungen', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-provider-')); t.after(() => cleanTestDirectory(root));
  const storage = prepareStorage(root), settings = new Settings(storage); settings.registerCameras(['door', 'side']);
  for (const info of PROVIDERS) {
    const config = { enabled: true, model: 'vision-test' };
    if (info.keyRequired || info.local && info.id !== 'ollama') config.apiKey = `secret-${info.id}`;
    if (info.id === 'compatible') config.baseUrl = 'https://vision.example.com/v1';
    await settings.update({ summaries: { [info.id]: config } });
    settings.updateProfile('door', { summaryProvider: info.id });
    assert.equal(new Settings(storage).profile('door').summaryProvider, info.id);
    assert.equal(JSON.stringify(settings.public()).includes(`secret-${info.id}`), false);
    if (info.id !== 'ollama') {
      await settings.update({ summaries: { [info.id]: { apiKey: '' } } }); assert.equal(settings.value.summaries[info.id].apiKey, `secret-${info.id}`);
      await settings.update({ summaries: { [info.id]: { clearKey: true } } }); assert.equal(settings.value.summaries[info.id].enabled, false); assert.equal(settings.public().summaries[info.id].keySet, false);
    }
  }
  assert.equal(settings.profile('side').summaryProvider, 'off');
  await assert.rejects(settings.update({ summaries: { unknown: { enabled: true } } }));
});

test('Lokale API-Adressen bleiben privat, Cloud-Presets fest; fremde Endpunkte akzeptieren keine Zugangsdaten oder Weiterleitungen', () => {
  assert.equal(normalizeProviderUrl('lmstudio', 'http://192.168.2.4:1234/v1/'), 'http://192.168.2.4:1234/v1');
  assert.equal(normalizeProviderUrl('compatible', 'https://vision.example.com/custom/v1/'), 'https://vision.example.com/custom/v1');
  for (const url of ['https://api.example.com/v1', 'http://169.254.169.254/v1', 'http://user:secret@localhost:1234/v1', 'http://localhost:1234/v1?key=secret']) assert.throws(() => normalizeProviderUrl('lmstudio', url));
  for (const url of ['http://vision.example.com/v1', 'https://localhost/v1', 'https://192.168.2.4/v1', 'https://169.254.169.254/v1', 'https://user:secret@vision.example.com/v1', 'https://vision.example.com/v1?key=secret']) assert.throws(() => normalizeProviderUrl('compatible', url));
  assert.throws(() => normalizeProviderUrl('gemini', 'https://different.example/v1'));
  assert.throws(() => normalizeProviderUrl('unknown', 'https://vision.example.com/v1'));
});

test('Kompatible Cloud- und lokale Vision-APIs erhalten JPEGs, Zeitpositionen und getrennte Authentifizierung; keine stillen Ausweichanbieter', async () => {
  const frames = [{ seconds: 1.25, bytes: Buffer.from([255, 216, 255, 217]) }];
  for (const info of PROVIDERS.filter(item => item.protocol === 'chat')) {
    const calls = [], baseUrl = info.id === 'compatible' ? 'https://vision.example.com/v1' : info.baseUrl;
    const providers = new SummaryProviders(async (url, options) => {
      calls.push({ url, options }); assert.equal(url, `${baseUrl}/chat/completions`); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      const body = JSON.parse(options.body); assert.equal(body.model, 'vision-test'); assert.equal(body.stream, false);
      assert.match(body.messages[0].content[1].text, /1.25/); assert.equal(body.messages[0].content[2].image_url.url, 'data:image/jpeg;base64,/9j/2Q==');
      assert.equal(body.messages[0].content[2].image_url.detail, undefined); assert.equal(options.body.includes('test-secret'), false);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Eine Person geht zur Tür.' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
    });
    const result = await providers.summarize(info.id, { enabled: true, model: 'vision-test', apiKey: 'test-secret', baseUrl }, frames, 'Synthetischer Test');
    assert.equal(result.text, 'Eine Person geht zur Tür.'); assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 }); assert.equal(calls.length, 1);
  }
  const providers = new SummaryProviders(async (_url, options) => { assert.equal(options.headers.Authorization, undefined); return Response.json({ choices: [{ finish_reason: 'length', message: { content: 'Unvollständig' } }] }); });
  await assert.rejects(providers.summarize('lmstudio', { enabled: true, model: 'vision-test', baseUrl: 'http://localhost:1234/v1' }, frames, 'Test'), /nicht vollständig/);
});

test('Claude nutzt das native Messages-Protokoll mit Base64-Bildern; Modellprüfung überträgt keine Aufnahmen', async () => {
  let calls = 0;
  const providers = new SummaryProviders(async (url, options) => {
    calls++; assert.equal(options.headers['x-api-key'], 'test-secret'); assert.equal(options.headers['anthropic-version'], '2023-06-01');
    if (url.endsWith('/models')) { assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); return Response.json({ data: [{ id: 'vision-test' }] }); }
    assert.equal(url, 'https://api.anthropic.com/v1/messages'); const body = JSON.parse(options.body);
    assert.equal(body.messages[0].content[2].source.media_type, 'image/jpeg'); assert.equal(body.max_tokens, 500);
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ein Hund ist sichtbar.' }], usage: { input_tokens: 5, output_tokens: 6 } });
  });
  const config = { enabled: true, model: 'vision-test', apiKey: 'test-secret' };
  const result = await providers.summarize('anthropic', config, [{ seconds: 0, bytes: Buffer.from([255, 216]) }], 'Test');
  assert.equal(result.text, 'Ein Hund ist sichtbar.'); assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 6 });
  const status = await providers.check('anthropic', config); assert.equal(status.visionVerified, false); assert.equal(status.models[0].name, 'vision-test'); assert.equal(calls, 2);
  const unavailable = new SummaryProviders(async () => new Response('private upstream detail and key', { status: 401 }));
  await assert.rejects(unavailable.check('gemini', config), error => /verweigert Zugriff/.test(error.message) && !error.message.includes('private upstream'));
});
