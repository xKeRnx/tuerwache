// Explicit hardware smoke test; stop the normal server first. Never run by npm test.
import { RingApi } from 'ring-client-api';
import { useLogger } from 'ring-client-api/util';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { LiveVideo } from '../src/live.mjs';
import { readJson, writeJson, prepareStorage } from '../src/storage.mjs';
useLogger({ logInfo() {}, logError() {} });
const [dataDirectory, cameraId] = process.argv.slice(2);
if (!dataDirectory || !cameraId) throw new Error('Datenordner und Kamera-ID erforderlich.');
const storage = prepareStorage(resolve(dataDirectory)), saved = readJson(storage.session, null);
if (!saved?.refreshToken) throw new Error('Keine bestehende Ring-Anmeldung gefunden.');
const api = new RingApi({ refreshToken: saved.refreshToken, ffmpegPath, avoidSnapshotBatteryDrain: true, controlCenterDisplayName: 'Türwache Live-Test' });
const subscription = api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => writeJson(storage.session, { refreshToken: newRefreshToken }));
let live;
try {
  const cameras = await api.getCameras();
  const service = { storage, cameras, phase: 'connected', features: { settings: { profile: () => ({ monitoring: true }) } } };
  live = new LiveVideo(service, () => true);
  const started = Date.now(), state = await live.start({ id: 'local-hardware-test' }, cameraId), job = live.job;
  const playlist = await live.asset(job.id, 'index.m3u8', job.ticket);
  const segments = playlist.body.match(/segment\d{5}\.ts/g) || [];
  if (!segments.length) throw new Error('Keine Live-Segmente empfangen.');
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', join(job.directory, segments[0]), '-frames:v', '1', '-f', 'null', '-'], { timeout: 15000, windowsHide: true });
  const report = { checkedAt: new Date().toISOString(), cameraId, status: state.status, firstPlayableMs: Date.now() - started, segments: segments.length, videoDecoded: true, audio: false, subscriptionRequired: false, note: 'Technischer Live-Test; keine Handy-Zustellung und keine Bildbewertung.' };
  writeJson(join(storage.root, 'live-test.json'), report); console.log(JSON.stringify(report));
} finally { await live?.stop(); subscription.unsubscribe(); api.disconnect(); }
// Ring's networking dependencies may retain idle timers after disconnect.
process.exit(0);
