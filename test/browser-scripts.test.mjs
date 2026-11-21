import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

test('Browser-Skripte lassen sich in HTML-Reihenfolge ohne globale Namenskonflikte laden', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
    .filter(([, attributes]) => !/\btype=["']module["']/.test(attributes))
    .map(([, attributes]) => /\bsrc=["']\/([^"'?]+)(?:\?[^"']*)?["']/.exec(attributes)?.[1])
    .filter(Boolean);
  assert.ok(scripts.includes('access.js'));
  const context = createContext(Object.create(null));
  for (const filename of scripts) {
    const script = new Script(readFileSync(join('public', filename), 'utf8'), { filename });
    try { script.runInContext(context, { timeout: 500 }); }
    catch (error) {
      // DOM APIs are intentionally absent: global declarations are still instantiated
      // before execution stops. Every following classic script shares that scope.
      assert.notEqual(error.name, 'SyntaxError', `${filename}: ${error.message}`);
    }
  }
});
