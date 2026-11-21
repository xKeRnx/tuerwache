import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { DiscordClient, normalizeWebhook, DISCORD_FILE_LIMIT } from '../src/discord.mjs';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { Settings } from '../src/settings.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { extractJpeg } from '../src/media.mjs';
import { cleanTestDirectory } from './helpers.mjs';

const webhook = 'https://discord.com/api/webhooks/123456789012345678/THIS_IS_AN_OFFLINE_TEST_TOKEN_1234567890';
async function directory(t) { const root = await mkdtemp(join(tmpdir(), 'tuerwache-discord-')); t.after(() => cleanTestDirectory(root)); return root; }
async function settle(features) { while (features.pending.size) await Promise.all([...features.pending]); }

test('Discord-Konfiguration erlaubt nur offizielle HTTPS-Webhooks und gibt Token niemals zurück', async t => {
  const storage = prepareStorage(await directory(t)), settings = new Settings(storage);
  await settings.update({ discord: { enabled: true, webhookUrl: webhook, personCooldownSeconds: 30 } });
  assert.equal(settings.public().discord.webhookSet, true);
  assert.equal(JSON.stringify(settings.public()).includes('THIS_IS_AN_OFFLINE_TEST_TOKEN'), false);
  await settings.update({ discord: { webhookUrl: '' } });
  assert.equal(settings.value.discord.webhookUrl, webhook);
  for (const invalid of ['http://discord.com/api/webhooks/123/token', 'https://localhost/api/webhooks/123/token', webhook + '/messages/1', webhook.replace('discord.com', 'discord.com.evil.example'), webhook + '?url=http://localhost']) assert.throws(() => normalizeWebhook(invalid));
  await assert.rejects(settings.update({ discord: { personCooldownSeconds: 0 } }));
  await settings.update({ discord: { clearWebhook: true } });
  assert.equal(settings.value.discord.enabled, false); assert.equal(settings.value.discord.webhookUrl, '');
});

test('Discord-HTTP-Vertrag: sofortige Textmeldung und echte Multipart-Anhänge mit gesperrten Mentions', async t => {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, bytes: Buffer.concat(chunks) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: '123456789' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const client = new DiscordClient((url, options) => {
    assert.equal(url, webhook + '?wait=true'); assert.equal(options.redirect, 'error');
    return fetch(`http://127.0.0.1:${server.address().port}/webhook?wait=true`, options);
  });
  const text = await client.send(webhook, '🔔 @everyone Türklingel'); assert.equal(text.status, 'sent');
  const payload = JSON.parse(requests[0].bytes); assert.deepEqual(payload.allowed_mentions.parse, []);
  const bytes = Buffer.from([0xff, 0xd8, 12, 42, 0xff, 0xd9]);
  const image = await client.send(webhook, 'Person erkannt', { name: 'person.jpg', type: 'image/jpeg', bytes });
  assert.equal(image.attachmentSent, true);
  assert.match(requests[1].headers['content-type'], /multipart\/form-data; boundary=/);
  assert.ok(requests[1].bytes.includes(bytes));
  assert.match(requests[1].bytes.toString(), /name="files\[0\]"; filename="person.jpg"/);
  assert.match(requests[1].bytes.toString(), /attachment:\/\/person.jpg/);
  const oversized = await client.send(webhook, 'Clip', { name: 'clip.mp4', type: 'video/mp4', bytes: Buffer.alloc(DISCORD_FILE_LIMIT + 1) });
  assert.equal(oversized.attachmentSent, false); assert.match(oversized.note, /8 MiB/);
  assert.match(requests[2].headers['content-type'], /application\/json/);
});

test('Discord beachtet Rate Limits, fällt bei Anhangsgröße auf Text zurück und bereinigt Fehler', async () => {
  let calls = 0;
  const rate = new DiscordClient(async () => ++calls === 1 ? new Response(JSON.stringify({ retry_after: 0.001 }), { status: 429 }) : new Response('{"id":"123"}', { status: 200 }));
  assert.equal((await rate.send(webhook, 'Test')).status, 'sent'); assert.equal(calls, 2);
  let oversizedCalls = 0;
  const fallback = new DiscordClient(async (_url, options) => {
    if (++oversizedCalls === 1) return new Response('', { status: 413 });
    assert.match(options.headers['Content-Type'], /json/); return new Response('{"id":"123"}', { status: 200 });
  });
  const result = await fallback.send(webhook, 'Clip', { name: 'clip.mp4', bytes: Buffer.from('video'), type: 'video/mp4' });
  assert.equal(result.attachmentSent, false); assert.equal(oversizedCalls, 2);
  const failed = new DiscordClient(async () => { throw new Error(webhook); });
  await assert.rejects(failed.send(webhook, 'Test'), error => !error.message.includes('THIS_IS_AN_OFFLINE_TEST_TOKEN') && /Zustellung unklar/.test(error.message));
});

test('Discord-Ablauf: Klingeln zuerst, fertiger Clip danach, Person mit tatsächlich dekodiertem Bild', async t => {
  const storage = prepareStorage(await directory(t)), service = new RingService(storage);
  const camera = { id: 'door', name: 'Haustür' }; service.cameras = [camera]; service.phase = 'connected';
  const features = new Features(service, resolve('.'));
  await features.settings.update({ discord: { enabled: true, webhookUrl: webhook } });
  features.updateCamera('door', { discordDing: true, discordDingClip: true, discordPerson: true, discordPersonImage: true, personDetection: true });
  const sent = [];
  features.discord.client = { send: async (_hook, content, file) => { sent.push({ content, file }); return { status: 'sent', attachmentSent: !!file, messageId: String(sent.length) }; } };
  service.onCameraEvent(camera, 'ding');
  await settle(features); assert.equal(sent.length, 1); assert.match(sent[0].content, /Es hat geklingelt/); assert.equal(sent[0].file, undefined);
  const source = service.events.find(entry => entry.type === 'ding');
  const motion = service.event('motion', camera, 'Earlier motion', {at:'2026-11-18T13:38:32Z'});
  source.at = '2026-11-18T13:38:38Z';
  const clip = service.event('clip', camera, 'Fixture', { cameraId: 'door', trigger: 'ding', sourceEventId: motion.id,
    sourceEventIds:[motion.id,source.id], status: 'ready', clip: 'fixture.mp4',
    video: { durationSeconds: 1, quality:{impaired:true,maxGapSeconds:1.997,decodeErrors:49}, transport:{missingPackets:463} } });
  // The notification uses real decoded image bytes rather than a fabricated preview.
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(storage.clips, clip.clip)], { windowsHide: true });
  features.ai.state = () => ({ modelsReady: true });
  features.ai.analyze = async () => ({ status: 'ready', personDetected: true, names: ['Testperson'], samples: [{ frameIndex: 5, fraction: 0.5, people: [{ score: 0.9 }], faces: [] }] });
  features.ready(clip); await settle(features);
  assert.equal(sent.length, 3); assert.match(sent[1].content, /Aufnahme zur Türklingel/); assert.equal(sent[1].file.type, 'video/mp4');
  assert.match(sent[1].content, /Klingeln: 14:38:38/);
  assert.match(sent[1].content, /Bildlücke 2,0 s.*463 fehlende Videopakete/);
  assert.match(sent[2].content, /Person erkannt/); assert.match(sent[2].content, /Testperson/);
  assert.equal(sent[2].file.type, 'image/jpeg'); assert.equal(sent[2].file.bytes[0], 0xff); assert.equal(sent[2].file.bytes[1], 0xd8);
  assert.equal(clip.discord.person.status, 'sent');
  features.ready(clip); await settle(features); assert.equal(sent.length, 3, 'Erneute KI-Auswertung verschickt dasselbe Ereignis nicht doppelt');
  features.updateCamera('door', { discordPersonImage: false });
  const second = service.event('clip', camera, 'Second fixture', { cameraId: 'door', status: 'ready', clip: 'fixture.mp4', ai: { status: 'ready', personDetected: true } });
  features.discord.enqueue(second, 'person'); await settle(features);
  assert.equal(second.discord.person.status, 'skipped'); assert.equal(sent.length, 3);
  await features.discord.retry(second.id, 'person'); await settle(features);
  assert.equal(sent.length, 4); assert.equal(sent[3].file, undefined, 'Bildschalter aus sendet ausschließlich Text');
  features.updateCamera('door', { monitoring: false });
  const count = service.events.length; service.onCameraEvent(camera, 'ding'); await settle(features);
  assert.equal(sent.length, 4); assert.equal(service.events.length, count);
  assert.throws(() => features.discord.retry(clip.id, 'person'), /freigeben/);
});

test('Personenbild entspricht dem angegebenen KI-Einzelbild und nicht pauschal der Clip-Mitte', async t => {
  const root = await directory(t), path = join(root, 'two-colors.mp4');
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10:d=0.5', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10:d=0.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { windowsHide: true });
  for (const [frameIndex, dominant] of [[0, 0], [7, 2]]) {
    const bytes = await extractJpeg(path, { frameIndex });
    const image = join(root, `frame-${frameIndex}.jpg`); await writeFile(image, bytes);
    const { stdout } = await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', image, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', windowsHide: true });
    assert.ok(stdout[dominant] > 200); assert.ok(stdout[dominant === 0 ? 2 : 0] < 50);
  }
});

test('Discord-Jobs sperren Clip-Löschung und Kamerawechsel und enden bei deaktivierter Verbindung', async t => {
  const storage = prepareStorage(await directory(t)), service = new RingService(storage);
  service.cameras = [{ id: 'door', name: 'Haustür' }];
  const features = new Features(service, resolve('.'));
  await features.settings.update({ discord: { enabled: true, webhookUrl: webhook } });
  features.updateCamera('door', { discordPerson: true });
  const entry = service.event('clip', service.cameras[0], 'Fixture', { cameraId: 'door', status: 'ready', clip: 'x.mp4', ai: { status: 'ready', personDetected: true } });
  let release; features.discord.tail = new Promise(resolve => { release = resolve; });
  let calls = 0; features.discord.client = { send: async () => { calls++; return { status: 'sent' }; } };
  features.discord.enqueue(entry, 'person');
  assert.throws(() => features.assertIdle(entry.id), /verarbeitet/);
  assert.throws(() => features.updateCamera('door', { monitoring: false }), /verarbeitet/);
  await features.settings.update({ discord: { enabled: false } }); release(); await settle(features);
  assert.equal(entry.discord.person.status, 'skipped'); assert.equal(calls, 0); assert.equal(features.jobs.size, 0);
});

test('Bewegungsclip und Szenenbild werden unabhängig von negativer Personenerkennung gesendet, Schalter und Zustellgründe bleiben wirksam',async t=>{
  const storage=prepareStorage(await directory(t)),service=new RingService(storage);service.cameras=[{id:'door',name:'Testkamera'}];
  const features=new Features(service,resolve('.'));
  await features.settings.update({discord:{enabled:true,webhookUrl:webhook},summaries:{ollama:{enabled:true,model:'vision:test'}}});
  features.updateCamera('door',{monitoring:true,recordMotion:true,personDetection:true,discordMotionClip:true,discordSummary:true,discordSummaryImage:true,summaryProvider:'ollama'});
  features.ai.state=()=>({modelsReady:true});features.ai.analyze=async()=>({status:'ready',personDetected:false,sampleCount:11,names:[],samples:[]});
  const sent=[];features.discord.client={send:async(_hook,text,file)=>{sent.push({text,file});return {status:'sent',attachmentSent:!!file};}};
  features.summaries.providers={summarize:async()=>({provider:'ollama',model:'vision:test',text:'Synthetische Szene ohne Person.'})};
  const entry=service.event('clip',service.cameras[0],'Fixture',{cameraId:'door',trigger:'motion',status:'ready',clip:'fixture.mp4',video:{durationSeconds:1}});
  await promisify(execFile)(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=160x120:r=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p',features.path(entry)],{windowsHide:true});
  features.ready(entry);await settle(features);
  assert.equal(sent.length,2);assert.match(sent[0].text,/Aufnahme bei Bewegung/);assert.equal(sent[0].file.type,'video/mp4');assert.ok(sent[0].file.bytes.length>0);
  assert.equal(sent[1].file.type,'image/jpeg');assert.deepEqual([...sent[1].file.bytes.subarray(0,2)],[255,216]);assert.match(sent[1].text,/Synthetische Szene/);
  assert.equal(entry.discord.person.status,'not-triggered');assert.match(entry.discord.person.message,/11 geprüften Bildern/);assert.equal(entry.discord.summary.attachmentExpected,true);
  features.ready(entry);await settle(features);assert.equal(sent.length,2,'Keine doppelten Zustellungen für dasselbe Ereignis');
  features.updateCamera('door',{discordMotionClip:false,discordSummaryImage:false});
  const second=service.event('clip',service.cameras[0],'Fixture',{cameraId:'door',trigger:'motion',status:'ready',clip:'fixture.mp4',video:{durationSeconds:1}});
  features.ready(second);await settle(features);assert.equal(sent.length,3);assert.equal(sent[2].file,undefined);assert.equal(second.discord.motionClip.status,'disabled');assert.match(second.discord.motionClip.message,/Kamera-Profil ausgeschaltet/);assert.equal(second.discord.summary.attachmentExpected,false);
  features.updateCamera('door',{discordMotionClip:true});await features.discord.retry(second.id,'motionClip');await settle(features);assert.equal(sent.length,4);assert.equal(sent[3].file.type,'video/mp4');
  features.updateCamera('door',{discordPerson:true,discordPersonImage:true});features.ai.analyze=async()=>({status:'ready',personDetected:true,sampleCount:11,names:[],samples:[]});
  let mobile=0;service.mobilePush={notify(){mobile++;}};
  await features.analyze(second.id,{notify:false});await settle(features);assert.equal(sent.length,4,'Manuelle Nachprüfung löst keine neuen Discord-Nachrichten aus');assert.equal(mobile,0);assert.equal(second.ai.personDetected,true);
});
