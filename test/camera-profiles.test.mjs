import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Settings } from '../src/settings.mjs';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { prepareStorage, writeJson } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tuerwache-profiles-'));
  t.after(() => cleanTestDirectory(directory));
  return prepareStorage(directory);
}

test('Kamera-Profile übernehmen bestehende Einstellungen, bleiben getrennt und starten neue Kameras pausiert', async t => {
  const storage = await fixture(t);
  writeJson(join(storage.root, 'settings.json'), { automaticCameras: ['door'], aiEnabled: true, cloud: { enabled: true, endpoint: '', bucket: '', region: 'auto', prefix: 'door/', accessKeyId: '', secretAccessKey: '' } });
  const settings = new Settings(storage);
  settings.registerCameras(['door', 'garden']);
  assert.equal(settings.profile('door').recordMotion, true);
  assert.equal(settings.profile('garden').recordMotion, false);
  assert.equal(settings.profile('garden').faceRecognition, true);
  settings.updateProfile('garden', { monitoring: false, faceRecognition: false, cloudUpload: false });
  settings.updateProfile('door', { recordMotion: false, recordDing: true, personDetection: true, faceRecognition: false });
  settings.registerCameras(['door', 'garden', 'new-camera']);
  assert.equal(settings.profile('new-camera').monitoring, false);
  assert.equal(settings.profile('door').recordDing, true);
  assert.deepEqual(new Settings(storage).profile('door'), settings.profile('door'));
  assert.equal(new Settings(storage).profile('garden').monitoring, false);
  await assert.rejects(async () => settings.updateProfile('door', { personDetection: 'false' }));
  await assert.rejects(async () => settings.updateProfile('door', { unimplementedSummary: true }));
});

test('Pausierte Kamera erzeugt keine Ereignisse oder Aufnahme; Bewegung und Klingeln getrennt', async t => {
  const storage = await fixture(t), service = new RingService(storage);
  service.phase = 'connected';
  const door = { id: 'door', name: 'Haustür', isOffline: false }, garden = { id: 'garden', name: 'Garten', isOffline: false };
  service.cameras = [door, garden];
  const features = new Features(service, resolve('.'));
  features.updateCamera('garden', { monitoring: false });
  features.updateCamera('door', { recordMotion: false, recordDing: true });
  const before = service.events.length, captures = [];
  await assert.rejects(service.capture('garden'), /pausiert/);
  service.capture = async (id, type) => { captures.push([id, type]); };
  service.onCameraEvent(garden, 'motion'); service.onCameraEvent(garden, 'ding');
  assert.equal(service.events.length, before);
  service.onCameraEvent(door, 'motion'); assert.equal(captures.length, 0);
  service.onCameraEvent(door, 'ding'); assert.deepEqual(captures, [['door', 'ding']]);
  assert.deepEqual(service.state().cameras[1].features, features.settings.profile('garden'));
});

test('Clipdauer und Aufnahmepause bleiben pro Kamera getrennt, validiert und über Neustarts gespeichert',async t=>{
  const storage=await fixture(t),settings=new Settings(storage);settings.registerCameras(['door','garden']);
  settings.updateProfile('door',{recordingSeconds:30,recordingCooldownSeconds:30,discordMotionClip:true,discordSummaryImage:true});
  assert.equal(new Settings(storage).profile('door').recordingSeconds,30);assert.equal(settings.profile('garden').recordingSeconds,10);assert.equal(settings.profile('garden').discordMotionClip,false);
  for(const input of [{recordingSeconds:0},{recordingSeconds:'30'},{recordingSeconds:600},{recordingCooldownSeconds:9},{recordingCooldownSeconds:3601},{recordingCooldownSeconds:10.5},{discordSummaryImage:'true'}])assert.throws(()=>settings.updateProfile('door',input));
  const service=new RingService(storage),camera={id:'door',name:'Testkamera'};service.features={settings};let captures=0;service.capture=async()=>{captures++;};
  service.lastAutomatic.set('door',Date.now()-31_000);service.onCameraEvent(camera,'motion');assert.equal(captures,0,'Aufnahme-Auslöser bleibt ausgeschaltet');
  settings.updateProfile('door',{monitoring:true,recordMotion:true});service.onCameraEvent(camera,'motion');assert.equal(captures,1);
  service.onCameraEvent(camera,'motion');assert.equal(service.events[0].recordingDecision.reason,'cooldown');assert.ok(service.events[0].recordingDecision.remainingSeconds<=30);
});

test('KI- und Cloud-Jobs beachten das Profil und übergeben nur aktivierte KI-Funktionen', async t => {
  const storage = await fixture(t), service = new RingService(storage);
  service.cameras = [{ id: 'door', name: 'Haustür' }, { id: 'garden', name: 'Garten' }];
  const features = new Features(service, resolve('.'));
  const entry = service.event('clip', service.cameras[0], 'Testclip', { cameraId: 'door', status: 'ready', clip: 'test.mp4' });
  const garden = service.event('clip', service.cameras[1], 'Testclip', { cameraId: 'garden', status: 'ready', clip: 'garden.mp4' });
  features.ai.state = () => ({ modelsReady: true, people: [], busy: false });
  const calls = [];
  features.ai.analyze = async (_path, _threshold, profile) => { calls.push(profile); return { status: 'ready', names: [] }; };
  let uploads = 0; features.cloud.upload = async () => { uploads++; return { status: 'uploaded' }; };
  features.settings.value.cloud.enabled = true;
  features.updateCamera('door', { personDetection: true, faceRecognition: false, cloudUpload: true });
  features.updateCamera('garden', { monitoring: false, personDetection: true, faceRecognition: true, cloudUpload: true });
  features.ready(entry); features.ready(garden);
  await Promise.all([...features.pending]);
  assert.equal(calls.length, 1); assert.equal(calls[0].personDetection, true); assert.equal(calls[0].faceRecognition, false); assert.equal(uploads, 1);
  assert.equal(garden.ai, undefined); assert.equal(garden.cloud, undefined);
  assert.throws(() => features.analyze(garden.id), /Kamera-Profil/);
  assert.throws(() => features.upload(garden.id), /Kamera-Profil/);
  features.updateCamera('door', { personDetection: false, faceRecognition: true, cloudUpload: false });
  await features.analyze(entry.id);
  assert.equal(calls[1].personDetection, false); assert.equal(calls[1].faceRecognition, true);
  assert.throws(() => features.upload(entry.id), /Kamera-Profil/);
  features.updateCamera('door', { faceRecognition: false });
  assert.throws(() => features.analyze(entry.id), /Kamera-Profil/);
});

test('Profilwechsel wartet auf Jobs und Pausieren beendet eine laufende Kamera-Aufnahme', async t => {
  const storage = await fixture(t), service = new RingService(storage);
  service.cameras = [{ id: 'door', name: 'Haustür' }];
  const features = new Features(service, resolve('.'));
  const entry = service.event('clip', service.cameras[0], 'Test', { cameraId: 'door', status: 'ready', clip: 'test.mp4' });
  features.jobs.add(`ai:${entry.id}`);
  assert.throws(() => features.updateCamera('door', { monitoring: false }), /verarbeitet/);
  assert.equal(features.settings.profile('door').monitoring, true);
  features.jobs.clear();
  let stopped = false;
  service.recording = { cameraId: 'door', cancelled: false, session: { stop() { stopped = true; } } };
  features.updateCamera('door', { monitoring: false });
  assert.equal(stopped, true); assert.equal(service.recording.cancelled, true);
});
