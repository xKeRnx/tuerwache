import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocs } from './build-docs.mjs';

const [directory, mode] = process.argv.slice(2);
if (!directory || (mode && mode !== '--website')) {
  throw Error('Usage: node scripts/export-docs.mjs NEW_OUTPUT_DIRECTORY [--website]');
}
const destination = resolve(directory);
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length) throw Error('The documentation export directory must be empty.');
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const navigation = mode === '--website'
  ? '<a class="back" href="/preise" data-de="Angebote" data-en="Plans">Angebote</a>' +
    '<a class="back" href="/hilfe" data-de="Support" data-en="Support">Support</a>' : '';
const html = (await buildDocs())
  .replace('<a class="back" href="/" data-de="Zur App ↗" data-en="Open app ↗">Zur App ↗</a>', navigation)
  .replace('href="/docs"', mode === '--website' ? 'href="/"' : 'href="./"')
  .replaceAll(/(href|src)="\/(icon\.svg|docs\.css|docs\.js|license\.txt|docs-media\/[a-z0-9-]+\.webp)"/g, '$1="./$2"');
await writeFile(join(destination, 'index.html'), html);
for (const name of ['docs.css', 'docs.js', 'icon.svg', 'license.txt']) await copyFile(join(source, name), join(destination, name));
await mkdir(join(destination, 'docs-media'));
for (const name of await readdir(join(source, 'docs-media'))) {
  if (/^[a-z0-9-]+\.webp$/.test(name)) await copyFile(join(source, 'docs-media', name), join(destination, 'docs-media', name));
}
console.log('Static documentation exported to ' + destination);
