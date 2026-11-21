import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { Settings } from '../src/settings.mjs';
import { SummaryProviders, normalizeOllamaUrl } from '../src/summary-providers.mjs';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { Summaries } from '../src/summaries.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';
import { summaryPositions, summaryFrameIndex } from '../src/scene-sampling.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-summaries-')); t.after(() => cleanTestDirectory(root)); return prepareStorage(root);
}
async function localAPI(t, handler) {
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let data; try { data = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null; } catch {}
    const response = await handler(req, data);
    res.writeHead(response.status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response.body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function clipFor(t) {
  const storage = await fixture(t), service = new RingService(storage);
  service.cameras = [{ id: 'door', name: 'Haustür' }]; const features = new Features(service, resolve('.'));
  const entry = service.event('clip', service.cameras[0], 'Synthetic video fixture', { cameraId: 'door', status: 'ready', clip: 'fixture.mp4', video: { durationSeconds: 1 } });
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x120:r=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', features.path(entry)], { windowsHide: true });
  return { storage, service, features, entry };
}
async function settle(features) { while (features.pending.size) await Promise.all([...features.pending]); }

test('KI-Auswahl bleibt pro Kamera gespeichert; Cloud-Schlüssel geheim; Ollama nur lokal', async t => {
  const storage = await fixture(t), settings = new Settings(storage);
  settings.registerCameras(['door', 'garden']);
  settings.updateProfile('door', { summaryProvider: 'ollama', sceneContext: 'Die Treppe führt zur Haustür.' });
  settings.updateProfile('garden', { summaryProvider: 'off' });
  await settings.update({ summaries: { ollama: { enabled: true, model: 'vision:test' }, openai: { enabled: true, model: 'vision-model', apiKey: 'test-secret-key' }, openaiDailyLimit: 5 } });
  assert.equal(new Settings(storage).profile('door').summaryProvider, 'ollama');
  assert.equal(settings.profile('garden').summaryProvider, 'off');
  assert.equal(settings.public().summaries.openai.keySet, true);
  assert.equal(JSON.stringify(settings.public()).includes('test-secret-key'), false);
  await settings.update({ summaries: { openai: { apiKey: '' } } }); assert.equal(settings.value.summaries.openai.apiKey, 'test-secret-key');
  for (const url of ['https://ollama.com', 'http://example.com', 'http://127.0.0.1:11434/api/chat', 'http://127.0.0.1:11434?x=1', 'http://secret@localhost:11434']) assert.throws(() => normalizeOllamaUrl(url));
  assert.equal(normalizeOllamaUrl('http://192.168.2.115:11434/'), 'http://192.168.2.115:11434');
  await assert.rejects(settings.update({ summaries: { ollama: { model: 'vision:cloud' } } }));
  assert.throws(() => settings.updateProfile('door', { summaryProvider: 'unknown-provider' }));
  await settings.update({ summaries: { openai: { clearKey: true } } }); assert.equal(settings.value.summaries.openai.enabled, false); assert.equal(settings.value.summaries.openai.apiKey, '');
});

test('Ollama-Vertrag: Modellliste, lokale Vision-Prüfung und drei gezielte echte JPEGs in Zeitreihenfolge', async t => {
  const requests = [];
  const baseUrl = await localAPI(t, (req, data) => {
    requests.push({ path: req.url, data });
    if (req.url === '/api/tags') return { body: { models: [{ name: 'vision:test', size: 123 }, { name: 'vision:cloud', size: 0 }] } };
    if (req.url === '/api/show') return { body: { capabilities: ['completion', 'vision'] } };
    return { body: { done: true, message: { role: 'assistant', content: 'Testantwort des lokalen API-Testservers. Zweiter Satz. Dritter Satz wird nicht angezeigt.' }, prompt_eval_count: 5, eval_count: 7 } };
  });
  const { features, entry } = await clipFor(t);
  await features.settings.update({ summaries: { ollama: { enabled: true, baseUrl, model: 'vision:test' } } });
  features.updateCamera('door', { summaryProvider: 'ollama', sceneContext: 'Die Treppe führt zur Tür.' });
  await features.summaries.checkOllama(); assert.equal(features.summaries.ollamaStatus.models.length, 1);
  await features.summaries.enqueue(entry.id); await settle(features);
  assert.equal(entry.summary.status, 'ready'); assert.equal(entry.summary.provider, 'ollama'); assert.equal(entry.summary.frameCount, 6);
  assert.equal(entry.summary.text, 'Testantwort des lokalen API-Testservers. Zweiter Satz.');
  const chat = requests.find(req => req.path === '/api/chat').data;
  assert.equal(chat.stream, false); assert.equal(chat.messages[0].images.length, 1);assert.equal(chat.options.num_ctx,8192);
  assert.ok(chat.messages[0].images.every(image => Buffer.from(image, 'base64').subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))));
  assert.match(chat.messages[0].content, /0.00 s, 0.15 s, 0.30 s/);assert.match(chat.messages[0].content,/0.45 s, 0.60 s, 0.75 s/); assert.match(chat.messages[0].content, /Die Treppe führt zur Tür/);
  assert.equal(JSON.stringify(chat).includes('known-faces'), false);
  const count = requests.length; await features.summaries.enqueue(entry.id); assert.equal(requests.length, count, 'Fertige automatische Zusammenfassung wird nicht doppelt angefragt');
});

test('OpenAI-Vertrag: festes Ziel, Schlüssel nur im Header, store:false und Tageslimit ohne weitere Anfrage', async t => {
  const requests = [];
  const endpoint = await localAPI(t, (req, data) => { requests.push({ req, data }); return { body: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Testantwort des Cloud-API-Testservers.' }] }], usage: { input_tokens: 30, output_tokens: 12 } } }; });
  const { features, entry, storage } = await clipFor(t);
  features.summaries.providers = new SummaryProviders((url, options) => { assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.redirect, 'error'); return fetch(endpoint, options); });
  await features.settings.update({ summaries: { openai: { enabled: true, model: 'vision-test', apiKey: 'offline-test-secret' }, openaiDailyLimit: 1 } });
  features.updateCamera('door', { summaryProvider: 'openai' });
  await features.summaries.enqueue(entry.id, true); assert.equal(entry.summary.status, 'ready');
  assert.equal(requests[0].req.headers.authorization, 'Bearer offline-test-secret'); assert.equal(requests[0].data.store, false);
  assert.equal(requests[0].data.input[0].content.filter(item => item.type === 'input_image').length, 6);
  assert.equal(JSON.stringify(requests[0].data).includes('offline-test-secret'), false); assert.equal(JSON.stringify(entry.summary).includes('offline-test-secret'), false);
  await features.summaries.enqueue(entry.id, true); assert.equal(entry.summary.status, 'error'); assert.match(entry.summary.message, /Tageslimit/); assert.equal(requests.length, 1);
  const restarted = new Summaries(features); assert.equal(restarted.dailyUsage().requests, 1);
  await features.settings.update({ summaries: { gemini: { enabled: true, model: 'vision-test', apiKey: 'other-offline-secret' } } });
  features.updateCamera('door', { summaryProvider: 'gemini' });
  await features.summaries.enqueue(entry.id, true); assert.equal(entry.summary.status, 'error'); assert.match(entry.summary.message, /Tageslimit/); assert.equal(requests.length, 1, 'Geteiltes Limit gilt auch nach Wechsel zu einem anderen Cloud-Anbieter');
});

test('Szenenbilder enthalten Clipanfang, Clipende und kurze tatsächliche Personensichtungen ohne Namensübertragung',()=>{
  const positions=summaryPositions({video:{durationSeconds:30,framesPerSecond:25},ai:{samples:[{seconds:9.1,people:[{}],faces:[]},{seconds:27.8,people:[],faces:[{name:'Privater Name'}]}]}});
  assert.ok(positions.includes(0)&&positions.includes(29.75)&&positions.includes(9.1)&&positions.includes(27.8));assert.equal(positions.length,6);assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
  const decoded={video:{durationSeconds:10.04,framesPerSecond:25.3},ai:{samples:[{seconds:0,fraction:0,frameIndex:0},{seconds:9.96,fraction:.996,frameIndex:252,people:[{}]}]}};
  assert.ok(summaryPositions(decoded).includes(9.96));assert.equal(summaryFrameIndex(decoded,9.96),252,'Letztes wirklich lesbares Bild wird nach Frame-Index statt ungenauer MP4-Zeit extrahiert');
  assert.ok(summaryPositions({video:{durationSeconds:30},ai:{samples:[{seconds:9.1,people:[{}]}]}},3).includes(9.1),'Auch drei lokale Szenenbilder enthalten den tatsächlichen Besucher');
});

test('Ollama-Ausfall löst niemals OpenAI-Fallback aus; Textmodelle und Cloud-Modelle werden abgelehnt', async t => {
  const calls = [];
  const { features, entry } = await clipFor(t);
  features.summaries.providers = new SummaryProviders(async (url) => { calls.push(url); throw new Error('network error containing private internals'); });
  await features.settings.update({ summaries: { ollama: { enabled: true, model: 'vision:test' }, openai: { enabled: true, model: 'vision-test', apiKey: 'offline-test-secret' } } });
  features.updateCamera('door', { summaryProvider: 'ollama' });
  await features.summaries.enqueue(entry.id); assert.equal(entry.summary.status, 'error'); assert.equal(calls.length, 1); assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:11434/')));
  assert.equal(JSON.stringify(entry.summary).includes('private internals'), false);
  const textOnly = new SummaryProviders(async () => new Response('{"capabilities":["completion"]}'));
  await assert.rejects(textOnly.inspect('http://127.0.0.1:11434', 'text:test'), /Bilder unterstützen/);
  const remote = new SummaryProviders(async () => new Response('{"remote_host":"https://ollama.com","capabilities":["vision"]}'));
  await assert.rejects(remote.inspect('http://127.0.0.1:11434', 'vision:test'), /lokal installiert/);
});

test('Zusammenfassungen beachten Pause, Job-Sperren und senden optional den fertigen Text an Discord', async t => {
  const { features, entry } = await clipFor(t);
  await features.settings.update({ summaries: { ollama: { enabled: true, model: 'vision:test' } }, discord: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123456789012345678/THIS_IS_AN_OFFLINE_TEST_TOKEN_1234567890' } });
  features.updateCamera('door', { summaryProvider: 'off', discordSummary: true });
  assert.throws(() => features.summaries.enqueue(entry.id, true), /zuerst freigeben/);
  features.updateCamera('door', { summaryProvider: 'ollama' });
  let release; features.summaries.tail = new Promise(resolve => { release = resolve; });
  features.summaries.providers = { summarize: async () => ({ provider: 'ollama', model: 'vision:test', text: 'Synthetische Testzusammenfassung.' }) };
  const messages = []; features.discord.client = { send: async (_hook, text) => { messages.push(text); return { status: 'sent' }; } };
  const task = features.summaries.enqueue(entry.id);
  assert.throws(() => features.assertIdle(entry.id), /verarbeitet/); assert.throws(() => features.updateCamera('door', { monitoring: false }), /verarbeitet/);
  release(); await task; await settle(features);
  assert.equal(messages.length, 1); assert.match(messages[0], /Synthetische Testzusammenfassung/); assert.match(messages[0], /Ollama \(lokal\)/);
  await features.summaries.enqueue(entry.id,true);await settle(features);assert.equal(messages.length,1,'Manuelle Vorschau speichert den Text ohne neue externe Benachrichtigung.');
  features.updateCamera('door', { monitoring: false }); assert.throws(() => features.summaries.enqueue(entry.id, true), /freigeben/);
});
