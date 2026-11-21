import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';

export async function cleanTestDirectory(directory) {
  const target = resolve(directory);
  const temporaryRoot = resolve(tmpdir()) + sep;
  if (!target.toLowerCase().startsWith(temporaryRoot.toLowerCase()) || !basename(target).startsWith('tuerwache-')) throw new Error('Unsicheres Test-Aufräumziel.');
  await rm(target, { recursive: true, force: true });
}
