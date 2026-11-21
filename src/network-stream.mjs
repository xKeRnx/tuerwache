import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, readFile, rm, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpeg from 'ffmpeg-for-homebridge';
import { ReplaySubject } from 'rxjs';

const partName = /^part\d{8,16}\.ts$/;
const minimumFree = 512 * 1024 ** 2;
const pixels = 160 * 90;
const emptyBuffer = 'Der Voraufnahmepuffer hat noch keine Videosegmente.';
const motionOutput = ['-map', '0:v:0', '-an', '-vf', 'fps=2,scale=160:90:flags=fast_bilinear,format=gray',
  '-threads', '1', '-c:v', 'rawvideo', '-f', 'rawvideo', 'pipe:1'];

export function playlistSegments(text) {
  let start, duration;
  const segments = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) duration = Number.parseFloat(line.slice(8)) * 1000;
    else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) start = Date.parse(line.slice(25));
    else if (partName.test(line) && Number.isFinite(start) && duration > 0) {
      segments.push({ name: line, start, end: start + duration });
      start += duration;
      duration = undefined;
    }
  }
  return segments;
}

function frames(onMotion) {
  const buffer = Buffer.alloc(pixels);
  let last = null, offset = 0, moving = 0, emitted = 0;
  return chunk => {
    for (let at = 0; at < chunk.length;) {
      const length = Math.min(pixels - offset, chunk.length - at);
      chunk.copy(buffer, offset, at, at + length);
      offset += length;
      at += length;
      if (offset < pixels) continue;
      if (last) {
        let changed = 0;
        for (let index = 0; index < pixels; index++) if (Math.abs(last[index] - buffer[index]) >= 22) changed++;
        moving = changed >= pixels * .035 ? moving + 1 : 0;
        const now = Date.now();
        if (moving >= 2 && now - emitted >= 2000) { onMotion(now); emitted = now; }
      }
      last = Buffer.from(buffer);
      offset = 0;
    }
  };
}

function launch(args, output = 'ignore', input = 'ignore') {
  const child = spawn(ffmpeg, args, { windowsHide: true, stdio: [input, output, 'ignore'] });
  const done = new Promise(resolve => {
    child.once('error', () => {});
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, done };
}

export class NetworkStream {
  constructor(root, input, { motion, motionInput, convert = false } = {}) {
    this.root = resolve(root);
    this.input = input;
    this.motion = motion;
    this.motionInput = motionInput;
    this.detecting = false;
    this.convert = convert;
    this.wanted = false;
    this.run = null;
    this.segments = [];
  }
  get ready() {
    return Boolean(this.wanted && this.segments.length && Date.now() - this.segmentAt < 12_000 && this.run?.process);
  }
  async segmentsOf(run) {
    const playlist = await readFile(join(run.directory, 'index.m3u8'), 'utf8').catch(() => '');
    // Joining RTSP halfway through a GOP can leave audio ahead of the first
    // independently decodable video. The following segments start on keyframes.
    return playlistSegments(playlist).filter(part => part.name !== 'part00000000.ts');
  }
  setWanted(wanted) {
    this.wanted = wanted;
    if (!wanted) { this.run?.detector?.child.kill(); this.run?.process?.child.kill(); return; }
    if (!this.loop) this.loop = this.maintain().finally(() => {
      this.loop = null;
      if (this.wanted) this.setWanted(true);
    });
  }
  setMotion(detecting) {
    if (this.detecting === detecting) return;
    this.detecting = detecting;
    if (this.motionInput) {
      if (detecting && this.motion && this.run) this.watchMotion(this.run);
      if (!detecting) this.run?.detector?.child.kill();
      return;
    }
    this.run?.process?.child.kill();
  }
  watchMotion(run) {
    if (run.detecting) return;
    run.detecting = (async () => {
      while (!run.ended && this.wanted && this.detecting) {
        run.detector = launch(['-nostdin', '-v', 'error', ...this.motionInput, ...motionOutput], 'pipe');
        run.detector.child.stdout.on('data', frames(at => {
          if (this.ready && this.run === run && this.wanted) this.motion(at);
        }));
        await run.detector.done;
        run.detector = null;
        if (!run.ended && this.wanted && this.detecting) await delay(2200, undefined, { ref: false });
      }
    })().finally(() => {
      run.detecting = null;
      if (!run.ended && this.wanted && this.detecting) this.watchMotion(run);
    });
  }
  async maintain() {
    while (this.wanted) {
      try {
        const disk = await statfs(this.root);
        if (disk.bavail * disk.bsize >= minimumFree) await this.start();
      } catch { /* Retry after a temporary storage or connection failure. */ }
      if (this.wanted) await delay(2500, undefined, { ref: false });
    }
  }
  async start() {
    const run = { directory: join(this.root, 'stream-' + randomUUID()), leases: 0 };
    await mkdir(run.directory, { mode: 0o700 });
    if (!this.wanted) { await rm(run.directory, { recursive: true, force: true }); return; }
    const args = [
      '-nostdin', '-hide_banner', '-loglevel', 'error', ...this.input,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...(this.convert ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-force_key_frames', 'expr:gte(t,n_forced*2)', '-threads', '2'] : ['-c:v', 'copy']),
      '-c:a', 'aac', '-ac', '1', '-ar', '48000', '-b:a', '64k',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '14', '-hls_delete_threshold', '3',
      '-hls_flags', 'delete_segments+temp_file+program_date_time+independent_segments',
      '-hls_segment_filename', join(run.directory, 'part%08d.ts'), join(run.directory, 'index.m3u8'),
    ];
    const motion = this.detecting && this.motion && !this.motionInput;
    if (motion) args.push(...motionOutput);
    this.run = run;
    this.segments = [];
    this.segmentAt = Date.now();
    run.process = launch(args, motion ? 'pipe' : 'ignore');
    if (motion) run.process.child.stdout.on('data', frames(at => {
      if (this.ready && this.wanted) motion(at);
    }));
    if (this.detecting && this.motion && this.motionInput) this.watchMotion(run);
    let polling = false;
    const monitor = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const segments = await this.segmentsOf(run);
        if (this.run !== run || run.ended) return;
        if (segments.at(-1)?.name !== this.segments.at(-1)?.name) this.segmentAt = Date.now();
        this.segments = segments;
        const disk = await statfs(this.root);
        if (Date.now() - this.segmentAt > 18_000 || disk.bavail * disk.bsize < minimumFree) run.process.child.kill();
      } catch { run.process.child.kill(); }
      finally { polling = false; }
    }, 700);
    monitor.unref();
    try { await run.process.done; }
    finally {
      clearInterval(monitor);
      run.ended = true;
      run.detector?.child.kill();
      this.run = null;
      this.segments = [];
      await Promise.all([run.detecting, this.cleanup(run)]);
    }
  }
  async cleanup(run) {
    if (run.ended && !run.leases) await rm(run.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  }
  async readyRun(isCancelled) {
    const until = Date.now() + 10_000;
    while (!isCancelled() && this.wanted && Date.now() < until && !this.ready) await delay(250);
    if (isCancelled()) throw Error('Aufnahme abgebrochen.');
    if (!this.ready) throw Error(emptyBuffer);
    return this.run;
  }
  async record(path, { start, pre, deadline, cancelled, closing }) {
    const run = await this.readyRun(cancelled);
    run.leases++;
    const stage = join(this.root, 'clip-' + randomUUID());
    const saved = new Map();
    try {
      await mkdir(stage, { mode: 0o700 });
      while (!cancelled()) {
        const end = deadline();
        for (const part of await this.segmentsOf(run)) {
          const precedesWindow = pre ? part.end <= start - pre * 1000 : part.start < start;
          if (precedesWindow || part.start >= end || saved.has(part.name)) continue;
          const source = join(run.directory, part.name), destination = join(stage, part.name);
          try { await link(source, destination); }
          catch (error) {
            if (error.code === 'ENOENT') continue;
            await copyFile(source, destination);
          }
          saved.set(part.name, part);
        }
        if (run.ended || [...saved.values()].at(-1)?.end >= end || Date.now() > end + 8000) break;
        await delay(300);
      }
      if (cancelled()) throw Error('Aufnahme abgebrochen.');
      if (!saved.size) throw Error(emptyBuffer);
      closing();
      const parts = [...saved.values()];
      // All segments were written by one muxer with a common MPEG-TS clock.
      // Feed them as one stream so separately probed durations cannot shift frames at joins.
      const output = launch(['-nostdin', '-v', 'error', '-f', 'mpegts', '-i', 'pipe:0',
        '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-movflags', '+faststart', '-y', path], 'ignore', 'pipe');
      const input = Readable.from((async function* () {
        for (const part of parts) yield* createReadStream(join(stage, part.name));
      })());
      const timeout = setTimeout(() => output.child.kill(), 15_000);
      try {
        const [sent, closed] = await Promise.allSettled([pipeline(input, output.child.stdin), output.done]);
        if (sent.status !== 'fulfilled' || closed.value?.code !== 0) throw Error('Netzwerkclip konnte nicht gespeichert werden.');
      } finally { clearTimeout(timeout); }
      return { preRollSeconds: Math.round(Math.max(0, start - parts[0].start) / 100) / 10,
        interrupted: Boolean(run.ended || parts.at(-1).end < deadline() - 500 ||
          parts.some((part, index) => index && part.start > parts[index - 1].end + 250)) };
    } finally {
      run.leases--;
      await rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      await this.cleanup(run);
    }
  }
  async live() {
    let stopped = false, process;
    const ended = new ReplaySubject(1);
    return {
      onCallEnded: ended,
      stop() { stopped = true; process?.child.kill(); },
      startTranscoding: async ({ output }) => {
        const run = await this.readyRun(() => stopped);
        run.leases++;
        process = launch(['-nostdin', '-v', 'error', '-live_start_index', '-1', '-i', join(run.directory, 'index.m3u8'),
          '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', ...output]);
        process.done.then(async () => {
          ended.next();
          ended.complete();
          run.leases--;
          await this.cleanup(run);
        });
      },
    };
  }
}
