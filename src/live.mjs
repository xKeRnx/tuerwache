import { verifyVideo } from './media.mjs';
import {inspectVideoQuality} from './video-quality.mjs';
import {videoInputOptions,configureVideoRecovery} from './video-transport.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Livebild antwortet nicht rechtzeitig.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export class LiveVideo {
  constructor(service, validUser) { this.service = service; service.live = this; this.validUser = validUser; this.root = resolve(service.storage.root, 'live'); this.job = null; }
  owned(user) { const job = this.job; if (!job || job.user.id !== user.id) throw new Error('Keine eigene Liveansicht aktiv.'); return job; }
  state(user) {
    const job = this.job;
    if (!job || job.user.id !== user.id || !this.validUser(job.user, job.cameraId)) return null;
    return { cameraId: job.cameraId, status: job.status, hasAudio: job.hasAudio ?? null, videoMode:'original', ...(job.video?{video:job.video}:{}), expiresAt: new Date(job.until).toISOString(), url: `/live/${job.id}/index.m3u8?ticket=${job.ticket}` };
  }
  async start(user, cameraId) {
    if (this.job) throw new Error('Eine Liveansicht läuft bereits.');
    const camera = this.service.cameras.find(camera => String(camera.id) === cameraId);
    const network = camera?.source === 'network';
    if (!network && this.service.phase !== 'connected') throw new Error('Bitte zuerst mit Ring verbinden.');
    if (!camera || camera.isOffline || !this.service.features.settings.profile(cameraId).monitoring) throw new Error('Kamera ist offline oder pausiert.');
    const id = randomUUID();
    const job = { id, user, cameraId, ticket: randomBytes(32).toString('hex'), until: Date.now() + 90000, status: 'starting', directory: resolve(this.root, id), cancelled: false };
    this.job = job;
    job.timer = setTimeout(() => this.stop(undefined, job).catch(() => {}), 90000); job.timer.unref();
    try {
      await mkdir(job.directory, { recursive: true, mode: 0o700 });
      const opening = (this.service.mediaHub && !network ? this.service.mediaHub.acquire(camera,'live') : camera.startLiveCall()).then(session => {
        if (job.cancelled) { session.stop(); throw new Error('Liveansicht beendet.'); }
        job.session = session; return session;
      });
      const session = await bounded(opening, 25000);
      if (!this.service.mediaHub) configureVideoRecovery(session);
      // The Ring SDK already requests source keyframes. Preserve those H.264
      // images without a resolution/FPS filter or another lossy encode.
      job.ended = session.onCallEnded.subscribe(() => { this.stop(undefined, job).catch(() => {}); });
      if (job.cancelled) throw new Error('Liveansicht beendet.');
      await bounded(session.startTranscoding({ input: videoInputOptions(), audio: ['-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1'], video: ['-c:v', 'copy'], output: ['-t', '90', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments+independent_segments', '-hls_segment_filename', join(job.directory, 'segment%05d.ts'), join(job.directory, 'index.m3u8')] }), 15000);
      const deadline = Date.now() + 15000;
      while (!job.cancelled && Date.now() < deadline) {
        const playlist = await readFile(join(job.directory, 'index.m3u8'), 'utf8').catch(() => '');
        const segment = /segment\d{5}\.ts/.exec(playlist)?.[0];
        if (segment) {
          const segmentPath=join(job.directory,segment),media=await verifyVideo(segmentPath);
          const quality=await inspectVideoQuality(segmentPath,undefined,{timeoutMs:12000}).catch(()=>null);
          if (job.cancelled) throw new Error('Liveansicht beendet.');
          job.hasAudio=media.hasAudio;
          // Transport headers may advertise e.g. 25 FPS while only 15 frames/s
          // actually arrive. Display the decoded rate, not that nominal label.
          job.video={codec:media.codec,width:media.width,height:media.height,framesPerSecond:quality?.averageFps,nominalFramesPerSecond:media.framesPerSecond};
          job.status='ready';return this.state(user);
        }
        await sleep(200);
      }
      throw new Error('Noch kein abspielbares Livebild empfangen.');
    } catch (error) { job.cancelled = true; await this.stop(undefined, job); throw new Error(error.message.startsWith('Live') || error.message.startsWith('Noch kein') ? error.message : 'Livebild konnte nicht gestartet werden.'); }
  }
  async stop(user, expectedJob) {
    const job = this.job;
    if (!job || (expectedJob && expectedJob !== job) || (user && job.user.id !== user.id)) return;
    if (job.stopping) return job.stopping;
    job.cancelled = true; clearTimeout(job.timer);
    job.stopping = Promise.resolve().then(async () => {
      job.ended?.unsubscribe(); job.session?.stop();
      // Only this generated UUID directory inside our fixed live root is disposable.
      const target = resolve(job.directory);
      if (dirname(target).toLowerCase() !== this.root.toLowerCase() || !/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Ungültiger Live-Speicherpfad.');
      try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); }
      finally { if (this.job === job) this.job = null; }
    });
    return job.stopping;
  }
  async asset(id, name, ticket) {
    const job = this.job;
    if (!job || job.cancelled || job.id !== id || job.ticket !== ticket || job.until < Date.now() || !this.validUser(job.user, job.cameraId) || !this.service.features.settings.profile(job.cameraId).monitoring) throw new Error('Liveansicht abgelaufen oder nicht freigegeben.');
    if (name === 'index.m3u8') {
      const playlist = await readFile(join(job.directory, name), 'utf8');
      return { type: 'application/vnd.apple.mpegurl', body: playlist.replace(/^(segment\d{5}\.ts)$/gm, `$1?ticket=${job.ticket}`) };
    }
    if (!/^segment\d{5}\.ts$/.test(name)) throw new Error('Live-Datei nicht gefunden.');
    return { type: 'video/mp2t', body: await readFile(join(job.directory, name)) };
  }
}
