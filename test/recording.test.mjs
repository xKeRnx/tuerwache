import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Subject, ReplaySubject } from 'rxjs';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { RingService, verifyVideo } from '../src/ring-service.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Aufnahme prüft echte MP4-Datei und räumt Fehler und Abbruch auf', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tuerwache-video-'));
  t.after(() => cleanTestDirectory(directory));
  const source = join(directory, 'fixture.mp4');
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x120:r=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.5', '-c:a', 'aac', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true });
  const sourceInfo = await verifyVideo(source);
  assert.equal(sourceInfo.decoded, true); assert.equal(sourceInfo.hasAudio, true); assert.equal(sourceInfo.audioCodec, 'aac');
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', source, '-map', '0:a:0', '-f', 'null', '-'], { windowsHide: true });
  assert.equal(sourceInfo.width, 160);
  assert.equal(sourceInfo.height, 120);
  assert.equal(sourceInfo.codec, 'h264');
  assert.ok(sourceInfo.durationSeconds >= 0.4 && sourceInfo.durationSeconds <= 0.6);
  const invalid = join(directory, 'invalid.mp4');
  await writeFile(invalid, 'not a video');
  await assert.rejects(verifyVideo(invalid));

  const service = new RingService(prepareStorage(join(directory, 'storage')));
  service.phase = 'connected';
  const camera = { id: 1, name: 'Testkamera (synthetisch)', isOffline: false };
  service.cameras = [camera];
  let stops = 0;
  let expectedSeconds = '10';
  camera.startLiveCall = async () => {
    const onVideoRtp = new Subject();
    const onCallEnded = new ReplaySubject(1);
    return {
      onVideoRtp, onCallEnded,
      startTranscoding: async options => {
        assert.ok(options.input.includes('-reorder_queue_size'));assert.ok(options.input.includes('-buffer_size'));
        assert.ok(!options.audio.includes('-an')); assert.equal(options.audio[options.audio.indexOf('-c:a') + 1], 'aac'); assert.ok(options.audio.includes('0:a:0?'));
        assert.equal(options.output[options.output.indexOf('-t') + 1], expectedSeconds);
        assert.match(options.output[options.output.indexOf('-movflags') + 1], /frag_keyframe/);
        await copyFile(source, options.output.at(-1));
        onVideoRtp.next({});
        onCallEnded.next();
      },
      stop: () => { stops++; },
    };
  };
  await service.capture('1');
  const entry = service.events[0];
  assert.equal(entry.status, 'ready'); assert.equal(entry.video.hasAudio, true); assert.match(entry.message, /Mit Ton/);
  assert.ok(entry.bytes > 0);
  assert.ok(entry.firstFrameMs >= 0);
  assert.equal(service.recording, null);
  assert.equal(stops, 1);
  await verifyVideo(join(service.storage.clips, entry.clip));
  await service.deleteClip(entry.id);
  await assert.rejects(readFile(join(service.storage.clips, entry.clip)), { code: 'ENOENT' });

  const customDirectory = join(directory, 'chosen-directory');
  await mkdir(customDirectory);
  let processed = 0;
  expectedSeconds = '30';
  service.features = { settings: { profile:()=>({monitoring:true,recordingSeconds:30}),value: { clipsDirectory: customDirectory } }, ready() { processed++; throw new Error('test processing failure'); }, beforeDelete: async () => {}, jobs: new Set() };
  await service.capture('1');
  const moved = service.events[0];
  assert.equal(moved.status, 'ready'); assert.equal(moved.directory, customDirectory); assert.equal(processed, 1);
  assert.equal(moved.requestedSeconds,30);assert.match(moved.message,/statt 30 Sekunden/);
  await verifyVideo(join(customDirectory, moved.clip));
  assert.equal(JSON.stringify(service.state()).includes(customDirectory.replaceAll('\\', '\\\\')), false);
  await service.deleteClip(moved.id);
  await assert.rejects(readFile(join(customDirectory, moved.clip)), { code: 'ENOENT' });

  // Independent cameras keep recording while a same-camera ding joins and
  // extends its current visit. Ending one camera must leave the other active.
  const ends=new Map();expectedSeconds='60';
  service.features.settings.profile=()=>({monitoring:true,recordMotion:true,recordDing:true,recordingSeconds:10,recordingCooldownSeconds:0,extendRecording:true});
  service.features.discord={enqueue(){}};
  const makeCamera=id=>({id,name:'Synthetic '+id,isOffline:false,startLiveCall:async()=>{
    const packets=new Subject(),ended=new ReplaySubject(1);ends.set(String(id),()=>ended.next());
    return {onVideoRtp:packets,onCallEnded:ended,stop(){},startTranscoding:async options=>{await copyFile(source,options.output.at(-1));packets.next({});}};
  }});
  const second=makeCamera(2),third=makeCamera(3);service.cameras.push(second,third);
  service.onCameraEvent(second,'motion');service.onCameraEvent(third,'motion');
  while([...service.recordings.values()].filter(job=>job.firstVideoAtMs).length<2)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(service.recordings.size,2);const firstJob=service.recordings.get('2'),oldDeadline=firstJob.deadlineMs;
  await new Promise(resolve=>setTimeout(resolve,30));service.onCameraEvent(second,'ding');assert.ok(firstJob.deadlineMs>oldDeadline);assert.ok(firstJob.deadlineMs<=firstJob.firstVideoAtMs+60000);assert.equal(firstJob.entry.trigger,'ding');assert.equal(firstJob.entry.sourceEventIds.length,2);assert.equal(firstJob.entry.extended,true);
  ends.get('2')();while(service.recordings.has('2'))await new Promise(resolve=>setTimeout(resolve,10));assert.equal(service.recordings.has('3'),true);ends.get('3')();await Promise.all([...service.captureTasks]);
  assert.equal(firstJob.entry.status,'ready');assert.ok(service.events.filter(event=>firstJob.entry.sourceEventIds.includes(event.id)).every(event=>event.recordingDecision.status==='recorded'));
  expectedSeconds='30';service.features.settings.profile=()=>({monitoring:true,recordingSeconds:30});

  camera.startLiveCall = async () => { throw new Error('Private Ring token: never expose this'); };
  await assert.rejects(service.capture('1'), /Aufnahme fehlgeschlagen/);
  assert.equal(service.events[0].status, 'error');
  assert.equal(service.recording, null);
  assert.ok(!JSON.stringify(service.state()).includes('never expose'));

  let resolveSession;
  camera.startLiveCall = () => new Promise(resolve => { resolveSession = resolve; });
  const capturing = service.capture('1');
  await assert.rejects(service.capture('1'), /bereits/);
  while (!resolveSession) await new Promise(resolve => setTimeout(resolve, 5));
  service.close();
  let lateStopped = false;
  resolveSession({ stop() { lateStopped = true; } });
  await assert.rejects(capturing, /abgebrochen/);
  assert.equal(lateStopped, true);
  assert.equal(service.recording, null);
});
