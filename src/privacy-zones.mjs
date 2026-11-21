import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-for-homebridge';

const execute = promisify(execFile);
const maxInput = 512 * 1024 * 1024;
let active = 0;

export function normalizeZones(value) {
  if (!Array.isArray(value) || value.length > 8) throw Error('Maximal acht Privatzonen pro Kamera.');
  return value.map(({ x, y, width, height } = {}) => {
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > 100 || y + height > 100) throw Error('Privatzone muss vollständig im Bild liegen.');
    return { x, y, width, height };
  });
}

export function privacyFilters(zones = []) {
  return normalizeZones(zones).map(({ x, y, width, height }) => `drawbox=x=floor(iw*${x}/100):y=floor(ih*${y}/100):w=ceil(iw*${width}/100)+2:h=ceil(ih*${height}/100)+2:color=black:t=fill`);
}

export async function prepareClipCopy(features, entry, zones, signal) {
  if (!zones.length && entry.local?.status !== 'deleted') return { path: features.path(entry), close: async () => {} };
  if (active >= 2) throw Error('Zwei Exporte laufen bereits. Bitte kurz warten.');
  active++;
  let directory;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    finally { active--; }
  };
  try {
    directory = await mkdtemp(join(tmpdir(), 'tuerwache-export-'));
    let source = features.path(entry);
    if (entry.local?.status === 'deleted') {
      if (entry.cloud?.status !== 'uploaded') throw Error('Video nicht verfügbar.');
      source = join(directory, 'source.mp4');
      const remote = await features.cloud.open(features.settings.value.cloud, entry.cloud);
      let size = 0;
      const limit = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > maxInput) callback(Error('Cloud-Clip ist zu groß für den Export.'));
        else callback(null, chunk);
      } });
      try { await pipeline(remote.body, limit, createWriteStream(source), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) }); }
      finally { remote.close(); }
    }
    if (!zones.length) return { path: source, close };
    const path = join(directory, 'export.mp4');
    await execute(ffmpeg, ['-nostdin', '-v', 'error', '-threads', '1', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-filter_threads', '1', '-vf', privacyFilters(zones).join(','), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-threads', '1', '-c:a', 'aac', '-movflags', '+faststart', path], { timeout: 60000, signal, windowsHide: true });
    if (!(await stat(path)).size) throw Error('Export ist leer.');
    return { path, close };
  } catch {
    await close();
    throw Error('Export konnte nicht erstellt werden. Die Originaldatei bleibt in der Mediathek.');
  }
}
