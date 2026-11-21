import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { cameraUrl } from '../src/camera-endpoint.mjs';
import { discoveryMatch } from '../src/onvif.mjs';
import { NetworkStream } from '../src/network-stream.mjs';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { verifyVideo } from '../src/media.mjs';
import { cleanTestDirectory } from './helpers.mjs';

const discoveryFixture = Buffer.from(`<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <s:Header><a:RelatesTo>urn:uuid:test</a:RelatesTo></s:Header>
  <s:Body><d:ProbeMatches><d:ProbeMatch><d:Scopes>onvif://www.onvif.org/name/Door%20camera</d:Scopes>
  <d:XAddrs>http://cam.local:8081/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`);

test('ONVIF akzeptiert passende Antworten aus dem Privatnetz und verwendet die Absender-IP', async () => {
  assert.deepEqual(discoveryMatch(discoveryFixture, '192.168.1.20', 'urn:uuid:test'),
    [{ name: 'Door camera', address: 'http://192.168.1.20:8081/onvif/device_service' }]);
  assert.deepEqual(discoveryMatch(discoveryFixture, '192.168.1.20', 'urn:uuid:other'), []);
  assert.deepEqual(discoveryMatch(discoveryFixture, '127.0.0.1', 'urn:uuid:test'), []);
  await assert.rejects(cameraUrl('rtsp://169.254.169.254/video', ['rtsp:']), /privaten Netzwerk/);
  await assert.rejects(cameraUrl('file:///private', ['rtsp:']), /ungültig/);
  const pinned = await cameraUrl('rtsp://cam.example.test:554/main', ['rtsp:'],
    async () => [{ address: '192.168.2.44', family: 4 }]);
  assert.equal(pinned.hostname, '192.168.2.44');
});

test('Ring- und RTSP-Kameras teilen Kameraübersicht, RTSP-Zugangsdaten bleiben verschlüsselt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-network-settings-'));
  const service = new RingService(prepareStorage(root));
  const features = new Features(service, process.cwd());
  t.after(async () => { service.close(); await features.drain(); await cleanTestDirectory(root); });
  const primary = service.ringAccounts.get();
  primary.phase = 'connected';
  primary.cameras = [{ id: 123, name: 'Ring-Beispiel' }];
  const options = { kind: 'rtsp', address: 'rtsp://192.168.2.10:554/main', name: 'Garage', username: 'camera-user',
    password: 'only-in-test-!@', preRoll: 10, monitoring: false, motion: false, convert: false };
  const added = await service.networkCameras.add(options);
  assert.deepEqual(service.state().cameras.map(camera => camera.source).sort(), ['network', 'ring']);
  const saved = await readFile(join(root, 'network-cameras.json'), 'utf8');
  assert.doesNotMatch(saved, /192\.168|camera-user|only-in-test/);
  assert.equal(service.networkCameras.update(added.id, { name: 'Hof', preRoll: 5 }).preRoll, 5);
  await assert.rejects(service.networkCameras.add(options), /bereits hinzugefügt/);
  service.networkCameras.remove(added.id);
  assert.deepEqual(service.state().cameras.map(camera => camera.source), ['ring']);
});

test('Voraufnahme übernimmt abgeschlossene Segmente in ein spielbares H.264-MP4', { timeout: 25_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-preroll-'));
  const buffer = join(root, 'buffer');
  await mkdir(buffer);
  const source = new NetworkStream(buffer, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15'], { convert: true });
  t.after(async () => { source.setWanted(false); await source.loop; await cleanTestDirectory(root); });
  source.setWanted(true);
  const until = Date.now() + 10_000;
  while (source.segments.length < 2 && Date.now() < until) await delay(150);
  assert.ok(source.ready);
  const start = Date.now(), output = join(root, 'clip.mp4');
  const captured = await source.record(output, { start, pre: 5, deadline: () => start + 2300,
    cancelled: () => false, closing: () => {} });
  assert.ok(captured.preRollSeconds >= 3);
  assert.equal(captured.interrupted, false);
  const video = await verifyVideo(output);
  assert.ok(video.durationSeconds > 4);
  assert.equal(video.codec, 'h264');
});
