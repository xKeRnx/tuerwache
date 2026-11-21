// Explicit hardware check. Stop the normal server first; never part of npm test.
import { RingApi } from 'ring-client-api';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { RingService } from '../src/ring-service.mjs';
import { Settings } from '../src/settings.mjs';
import { LiveVideo } from '../src/live.mjs';
import { readJson, writeJson, prepareStorage } from '../src/storage.mjs';
const [dataDirectory, cameraId] = process.argv.slice(2);
if (!dataDirectory || !cameraId) throw new Error('Datenordner und Kamera-ID erforderlich.');
const storage = prepareStorage(resolve(dataDirectory)), saved = readJson(storage.session, null);
if (!saved?.refreshToken) throw new Error('Keine bestehende Ring-Anmeldung gefunden.');
const api = new RingApi({ refreshToken: saved.refreshToken, ffmpegPath, avoidSnapshotBatteryDrain: true, controlCenterDisplayName: 'Türwache Audiotest' });
const subscription = api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => writeJson(storage.session, { refreshToken: newRefreshToken }));
const service = new RingService(storage);
let live;
try {
  service.cameras = await api.getCameras(); service.phase = 'connected';
  // Read the existing profile unchanged. This check deliberately has no notification jobs.
  service.features = { settings: new Settings(storage), ready() {} };
  await service.capture(cameraId);
  const entry = service.events.find(item => item.cameraId === cameraId && item.type === 'clip');
  const file = join(entry.directory || storage.clips, entry.clip);
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', file, '-map', '0:a:0', '-t', '2', '-f', 'null', '-'], { timeout: 15000, windowsHide: true });
  live = new LiveVideo(service, () => true);
  const state = await live.start({ id: 'local-audio-check' }, cameraId), job = live.job;
  const playlist = await live.asset(job.id, 'index.m3u8', job.ticket), segment = /segment\d{5}\.ts/.exec(playlist.body)?.[0];
  if (!segment) throw new Error('Kein Live-Segment empfangen.');
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', join(job.directory, segment), '-map', '0:a:0', '-t', '1', '-f', 'null', '-'], { timeout: 15000, windowsHide: true });
  const report = { checkedAt: new Date().toISOString(), cameraId, clipId: entry.id, video: entry.video, clipAudioDecoded: true, liveAudioDecoded: state.hasAudio === true, note: 'Technische Tonprüfung an der tatsächlichen Kamera; keine Benachrichtigungen oder Cloud-Auswertung, kein Hörtest auf einem Handy.' };
  writeJson(join(storage.root, 'audio-test.json'), report); console.log(JSON.stringify(report));
} finally { await live?.stop(); service.close(); subscription.unsubscribe(); api.disconnect(); }
process.exit(0);
