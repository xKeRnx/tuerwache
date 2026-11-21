// Explicit live test of the complete summary job. Never run by npm test.
// Uses isolated settings; real camera profiles are neither read nor changed.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyVideo } from '../src/media.mjs';
import { RingService } from '../src/ring-service.mjs';
import { Features } from '../src/features.mjs';
import { prepareStorage } from '../src/storage.mjs';
import { cleanTestDirectory } from './helpers.mjs';
const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error('Video-Datei und Berichtspfad angeben.');
const temporary = await mkdtemp(join(tmpdir(), 'tuerwache-live-summary-'));
try {
  const video = await verifyVideo(file), service = new RingService(prepareStorage(temporary));
  service.cameras = [{ id: 'smoke-door', name: 'Isolierter Ring-Clip-Test' }];
  const features = new Features(service, resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  await features.settings.update({ summaries: { ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5vl:3b' } } });
  features.updateCamera('smoke-door', { summaryProvider: 'ollama' });
  const entry = service.event('clip', service.cameras[0], 'Read-only live fixture', { cameraId: 'smoke-door', status: 'ready', directory: dirname(file), clip: basename(file), video });
  await features.summaries.enqueue(entry.id, true);
  if (entry.summary.status !== 'ready') throw new Error(entry.summary.message || 'Zusammenfassung fehlgeschlagen.');
  const report = { checkedAt: new Date().toISOString(), sourceFile: basename(file), video, ...entry.summary, pipeline: 'Features → Summaries → Ollama', productionProfilesChanged: false, semanticAccuracyGuaranteed: false };
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  await features.drain(); console.log(JSON.stringify(report));
} finally { await cleanTestDirectory(temporary); }
