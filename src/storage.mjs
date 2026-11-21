import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function writeJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

export function prepareStorage(root) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const clips = join(root, 'clips');
  mkdirSync(clips, { recursive: true, mode: 0o700 });
  return { root, clips, session: join(root, 'session.json'), events: join(root, 'events.json') };
}
