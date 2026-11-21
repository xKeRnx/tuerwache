import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'public', 'test', 'scripts']) {
  for (const file of readdirSync(directory).filter(name => /\.(mjs|js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', join(directory, file)], { stdio: 'inherit', windowsHide: true });
    if (result.status) process.exit(result.status);
  }
}
console.log('JavaScript-Syntax geprüft.');
