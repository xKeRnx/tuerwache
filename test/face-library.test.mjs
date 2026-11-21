import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AIService } from '../src/ai-service.mjs';
import { cleanTestDirectory } from './helpers.mjs';
import { confirmedSummaryIdentities, anonymousSceneText, appendConfirmedNames } from '../src/identity-summary.mjs';

test('Alte Gesichtsvorlage bleibt erhalten; zusätzliche Fotos sind getrennt, begrenzt, löschbar und nicht öffentlich', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tuerwache-face-library-')); t.after(() => cleanTestDirectory(root));
  const legacy = { id: 'existing-person', name: 'Joscha', at: '2026-01-01T00:00:00Z', embedding: Array(128).fill(0.125) };
  await writeFile(join(root, 'known-faces.json'), JSON.stringify([legacy]));
  const ai = new AIService(root, resolve('.')); ai.request = async () => ({ embedding: Array(128).fill(0.25) }); t.after(() => ai.close());
  assert.equal(ai.state().people[0].templateCount, 1); assert.deepEqual(ai.people[0].templates[0].embedding, legacy.embedding);
  const image = n => 'data:image/jpeg;base64,' + Buffer.from(`synthetic-image-${n}`).toString('base64');
  const revision = ai.galleryRevision(); const first = await ai.enroll({ name: 'JOSCHA', image: image(1) }); assert.equal(first.id, legacy.id); assert.equal(first.templateCount, 2); assert.notEqual(ai.galleryRevision(), revision);
  assert.equal((await ai.enroll({ personId: legacy.id, image: image(1) })).duplicate, true);
  await Promise.all([ai.enroll({ name: 'Joscha', image: image(2) }), ai.enroll({ name: 'Joscha', image: image(3) })]); assert.equal(ai.people.length, 1); assert.equal(ai.state().people[0].templateCount, 4);
  const persisted = JSON.parse(await readFile(ai.file, 'utf8')); assert.equal(persisted[0].embedding, undefined); assert.deepEqual(persisted[0].templates[0].embedding, legacy.embedding);
  const restored = new AIService(root, resolve('.')); assert.equal(restored.state().people[0].templateCount, 4); assert.equal(JSON.stringify(restored.state()).includes('embedding'), false); assert.equal(JSON.stringify(restored.state()).includes('hash'), false);
  for (let i = 4; i < 12; i++) await ai.enroll({ personId: legacy.id, image: image(i) });
  await assert.rejects(ai.enroll({ personId: legacy.id, image: image(12) }), /Maximal 12/);
  ai.removeTemplate(legacy.id, 'legacy'); assert.equal(ai.state().people[0].templateCount, 11);
  for (const template of [...ai.people[0].templates].slice(1)) ai.removeTemplate(legacy.id, template.id);
  assert.equal(ai.state().people[0].templateCount, 1); assert.throws(() => ai.removeTemplate(legacy.id, ai.people[0].templates[0].id), /letzte Vorlage/);
  await assert.rejects(ai.enroll({ personId: 'missing', image: image(13) }), /Person nicht gefunden/);
});

test('Szenen erhalten Namen nur aus aktueller Mehrbild-Evidenz; alte, einzelne oder manuelle Namen reichen nicht', () => {
  const person = { id: 'a', name: 'Joscha' }, ai = { people: [person], galleryRevision: () => 'current' }, profile = { faceRecognition: true };
  const entry = { ai: { status: 'ready', identityVersion: 2, galleryRevision: 'current', confirmedIdentities: [{ personId: 'a', name: 'Nicht vertrauen', trackId: 'face-1', frames: 3, source: 'local-multiframe' }], samples: [0, 1, 2].map(i => ({ frameIndex: i * 10, seconds: i * 0.5, faces: [{ trackId: 'face-1', personId: 'a', identityConfirmed: true }] })) } };
  const confirmed = confirmedSummaryIdentities(entry, ai, profile); assert.equal(confirmed[0].name, 'Joscha');
  assert.match(appendConfirmedNames('Eine Person geht zur Tür.', confirmed), /Lokale Gesichtserkennung.*Joscha/);
  assert.throws(() => anonymousSceneText('Joscha läuft zur Tür.', [person]), /Namensvermutung/);
  assert.throws(() => anonymousSceneText('Joschas Auto steht dort.', [person]), /Namensvermutung/);
  assert.equal(anonymousSceneText('Eine Person läuft zur Tür.', [person]), 'Eine Person läuft zur Tür.');
  assert.throws(() => anonymousSceneText('Anna (Mama) steht dort.', [{ name: 'Anna (Mama)' }]), /Namensvermutung/);
  const altered = structuredClone(entry); altered.ai.samples = altered.ai.samples.slice(0, 1); assert.deepEqual(confirmedSummaryIdentities(altered, ai, profile), []);
  altered.ai.samples = entry.ai.samples; altered.ai.galleryRevision = 'old'; assert.deepEqual(confirmedSummaryIdentities(altered, ai, profile), []);
  altered.ai.galleryRevision = 'current'; altered.ai.identityVersion = 1; assert.deepEqual(confirmedSummaryIdentities(altered, ai, profile), []);
  assert.deepEqual(confirmedSummaryIdentities(entry, ai, { faceRecognition: false }), []);
  assert.deepEqual(confirmedSummaryIdentities({ ai: { status: 'ready', names: ['Joscha'] }, peopleAssignments: [person] }, ai, profile), []);
});
