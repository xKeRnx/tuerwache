import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ReplaySubject } from 'rxjs';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { LiveVideo } from '../src/live.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';

test('Live-HLS erzeugt echte Videosegmente und schützt jeden Abruf mit ablaufender, widerrufbarer Freigabe', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-live-')); t.after(() => cleanTestDirectory(root));
  const source=join(root,'source.mp4');
  await promisify(execFile)(ffmpegPath,['-v','error','-f','lavfi','-i','testsrc2=s=960x960:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','60','-c:a','aac',source],{windowsHide:true});
  const camera = { id: 'door', isOffline: false, startLiveCall: async () => ({
    onCallEnded: new ReplaySubject(1), stop() {},
    startTranscoding: async options => {
      assert.equal(options.video[options.video.indexOf('-c:v')+1],'copy');assert.ok(!options.video.includes('-vf'));
      await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', source, ...options.audio, ...options.video, ...options.output.filter((_, index) => index !== 0 && index !== 1)], { windowsHide: true });
    },
  }) };
  const service = { storage: prepareStorage(root), cameras: [camera], phase: 'connected', features: { settings: { profile: () => ({ monitoring: true }) } } };
  let authorized = true; const live = new LiveVideo(service, () => authorized), user = { id: 'user' };
  const state = await live.start(user, 'door'); assert.equal(state.status, 'ready'); assert.equal(state.hasAudio, true);
  assert.equal(state.videoMode,'original');assert.equal(state.video.width,960);assert.equal(state.video.height,960);assert.equal(state.video.framesPerSecond,30);
  await assert.rejects(live.start(user, 'door'), /bereits/);
  const job = live.job, playlist = await live.asset(job.id, 'index.m3u8', job.ticket);
  assert.match(playlist.body, /segment\d{5}\.ts\?ticket=[a-f0-9]{64}/);
  const filename = /segment\d{5}\.ts/.exec(playlist.body)[0], segment = await live.asset(job.id, filename, job.ticket);
  await promisify(execFile)(ffmpegPath, ['-v', 'error', '-i', join(job.directory, filename), '-map', '0:a:0', '-f', 'null', '-'], { windowsHide: true });
  assert.ok(segment.body.length > 0); assert.equal(segment.type, 'video/mp2t');
  await assert.rejects(live.asset(job.id, filename, 'wrong')); await assert.rejects(live.asset(job.id, '../users.json', job.ticket));
  authorized = false; await assert.rejects(live.asset(job.id, filename, job.ticket)); authorized = true;
  job.until = Date.now() - 1; await assert.rejects(live.asset(job.id, filename, job.ticket));
  await live.stop({ id: 'other-user' }); assert.ok(live.job); await live.stop(user); assert.equal(live.job, null);
  await assert.rejects(readFile(join(job.directory, filename)), { code: 'ENOENT' });
});

test('Abgebrochene Liveansicht schließt auch eine verspätete Ring-Verbindung', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-live-cancel-')); t.after(() => cleanTestDirectory(root));
  let resolveCall, stopped = false;
  const service = { storage: prepareStorage(root), phase: 'connected', cameras: [{ id: 'door', startLiveCall: () => new Promise(resolve => { resolveCall = resolve; }) }], features: { settings: { profile: () => ({ monitoring: true }) } } };
  const live = new LiveVideo(service, () => true), starting = live.start({ id: 'user' }, 'door');
  while (!resolveCall) await new Promise(resolve => setTimeout(resolve, 5));
  await live.stop(); resolveCall({ stop() { stopped = true; } });
  await assert.rejects(starting, /beendet/); assert.equal(stopped, true); assert.equal(live.job, null);
});

test('Livequalität zeigt tatsächlich dekodierte FPS statt der nominalen Transport-Bildrate',async t=>{
  const root=await mkdtemp(join(tmpdir(),'tuerwache-live-vfr-'));t.after(()=>cleanTestDirectory(root));
  const source=join(root,'source.mp4');
  await promisify(execFile)(ffmpegPath,['-v','error','-f','lavfi','-i','testsrc2=s=800x800:r=30','-t','6','-vf','select=not(mod(n\\,2))','-fps_mode','vfr','-c:v','libx264','-preset','ultrafast','-x264-params','fps=30/1','-g','30',source],{windowsHide:true});
  const camera={id:'door',startLiveCall:async()=>({onCallEnded:new ReplaySubject(1),stop(){},startTranscoding:async options=>{
    await promisify(execFile)(ffmpegPath,['-v','error','-i',source,...options.audio,...options.video,...options.output.slice(2)],{windowsHide:true});
  }})};
  const service={storage:prepareStorage(root),cameras:[camera],phase:'connected',features:{settings:{profile:()=>({monitoring:true})}}};
  const live=new LiveVideo(service,()=>true);t.after(()=>live.stop());
  const state=await live.start({id:'vfr-user'},'door');
  assert.equal(state.video.width,800);assert.equal(state.video.height,800);assert.equal(state.hasAudio,false);
  assert.ok(state.video.framesPerSecond>14.8&&state.video.framesPerSecond<15.2);
  assert.ok(state.video.nominalFramesPerSecond>state.video.framesPerSecond*1.5,'Transport header advertises a higher rate than the decoded frames');
});
