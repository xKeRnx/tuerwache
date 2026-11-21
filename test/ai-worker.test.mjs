import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { AIService } from '../src/ai-service.mjs';
import { cleanTestDirectory } from './helpers.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-worker-')); t.after(() => cleanTestDirectory(root));
  const ai = new AIService(root, resolve('.'), { spawnImpl: () => spawn(process.execPath, [resolve('test/fixtures/worker-double.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }), startupTimeout: 3000, ...options });
  t.after(() => ai.close()); return ai;
}
test('Dauerhafter Worker verarbeitet Aufträge der Reihe nach und überlebt ungültige Fotos', async t => {
  const ai = await fixture(t), first = await ai.run({ value: 1 }), pid = ai.worker.child.pid;
  assert.equal(first.value, 1); assert.equal(first.worker, undefined);
  await assert.rejects(ai.run({ mode: 'error' }), /genau einem/);
  const results = await Promise.all([ai.run({ value: 2 }), ai.run({ value: 3 })]); assert.deepEqual(results.map(item => item.value), [2, 3]); assert.equal(ai.worker.child.pid, pid);
  assert.equal(ai.state().worker.completedJobs, 3); assert.equal(ai.state().pendingJobs, 0);
  await ai.close(); assert.equal(ai.worker, null); await assert.rejects(ai.run({}), /beendet/);
});
test('Worker-Absturz, Zeitüberschreitung und fehlerhafte Antworten scheitern begrenzt; nächster Auftrag startet neu', async t => {
  const ai = await fixture(t, { jobTimeout: 180 });
  for (const mode of ['crash', 'hang', 'malformed', 'oversized']) {
    await ai.run({ value: 'before' }); const pid = ai.worker.child.pid;
    await assert.rejects(ai.run({ mode })); assert.equal(ai.worker, null);
    assert.equal((await ai.run({ value: 'after' })).value, 'after'); assert.notEqual(ai.worker.child.pid, pid);
  }
});
test('Worker ohne Python meldet einen bereinigten Startfehler statt zu hängen', async t => {
  const ai = await fixture(t, { spawnImpl: () => spawn('tuerwache-missing-python-command', [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }) });
  await assert.rejects(ai.run({}), /Python 3.12/); assert.equal(ai.state().worker.status, 'error');
});
test('Mehrbild-Bestätigung lehnt widersprüchliche, einzelne und mehrdeutige Treffer ab', { skip: !process.env.TEST_AI }, () => {
  const python = process.env.AI_PYTHON || (process.platform === 'win32' ? 'py' : 'python3'), prefix = process.platform === 'win32' && !process.env.AI_PYTHON ? ['-3.12'] : [];
  const result = spawnSync(python, [...prefix, 'test/face-tracks.py'], { windowsHide: true, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
});
