// Explicit source allowlist. Never export the running installation's user data.
import { readdir, mkdir, copyFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const defaultSource = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trees = ['src', 'public', 'ai', 'deploy', 'docs', 'scripts', 'test'];
const rootFiles = ['package.json', 'package-lock.json', 'README.md', 'README.en.md', 'LICENSE.md', '.gitignore', '.dockerignore', '.env.example', 'Start-Tuerwache.cmd', 'Start-Ollama.cmd'];
const mobileFiles = ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'App.tsx', 'index.ts', 'app.config.js', 'app.json', 'eas.json', 'tsconfig.json', 'eslint.config.js', '.env.example', '.gitignore'];
const blocked = /(^|\/)(?:node_modules|data|backups|artifacts|\.git|\.claude|\.expo|\.runtime|\.venv|__pycache__|android|ios|dist)(\/|$)|\.(?:onnx|download|log|key|pem|p12|keystore|pyc|apk|aab|ipa)$|(^|\/)\.env(?:\..+)?$|(?:google-services\.json|GoogleService-Info\.plist)$/i;
export async function exportRepository(source, destination, { publicRelease = false } = {}) {
  source = await realpath(source); destination = resolve(destination);
  const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path;
  const inside = path => normalize(path) === normalize(source) || normalize(path).startsWith(normalize(source + sep));
  if (inside(destination)) throw Error('Destination must be outside the source tree');
  await mkdir(destination, { recursive: true });
  destination = await realpath(destination);
  if (inside(destination)) throw Error('Destination must be outside the source tree');
  if ((await readdir(destination)).length) throw Error('Destination must be empty; existing files are never overwritten');
  const files = [];
  async function copy(name) {
    name = name.replaceAll('\\', '/');
    if (blocked.test(name) && !name.endsWith('/.env.example') && name !== '.env.example') return;
    if (publicRelease && /^test\/(?:fixtures\/(?:face|people)\.jpg|preview\.mjs)$/.test(name)) return;
    const path = join(source, name);
    let info; try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw Error('Symlink excluded: ' + name);
    if (info.isDirectory()) { for (const entry of await readdir(path)) await copy(name + '/' + entry); return; }
    if (!info.isFile()) return;
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await copyFile(path, join(destination, name)); files.push(name);
  }
  for (const path of [...rootFiles, ...trees, ...mobileFiles.map(name => 'mobile/' + name), 'mobile/src', 'mobile/assets']) await copy(path);
  await writeFile(join(destination, 'repository-export.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: files.sort(), note: 'Source allowlist export. Review source/configuration for manually embedded secrets before pushing.' }, null, 2));
  return files;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const destination = process.argv[process.argv.indexOf('--destination') + 1];
  if (!process.argv.includes('--destination') || !destination) throw Error('Usage: node scripts/prepare-repository.mjs --destination EMPTY_DIRECTORY');
  const files = await exportRepository(defaultSource, destination, { publicRelease: process.argv.includes('--public') });
  console.log(`Exported ${files.length} source files to ${resolve(destination)}. No data, model weights, APKs or repository metadata copied. Review before pushing.`);
}
