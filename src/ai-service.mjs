import { spawn } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readJson, writeJson } from './storage.mjs';
import { environmentFaceWorker } from './face-worker-config.mjs';

export const MAX_FACE_TEMPLATES = 12;
const validEmbedding = (vector, length) => Array.isArray(vector) && vector.length === length && vector.every(Number.isFinite);
export class AIService {
  constructor(root, projectRoot, { spawnImpl = spawn, startupTimeout = 20_000, jobTimeout = 120_000, faceWorker = environmentFaceWorker, pythonEnv = {} } = {}) {
    this.root = root; this.projectRoot = projectRoot; this.file = join(root, 'known-faces.json'); this.faceWorker = faceWorker; this.pythonEnv = pythonEnv;
    this.people = readJson(this.file, []).map(({ embedding, ...person }) => ({ ...person, revision: person.revision || createHash('sha256').update(JSON.stringify(embedding || person.templates)).digest('hex'), templates: person.templates || (embedding ? [{ id: 'legacy', at: person.at, embedding }] : []) }));
    this.busy = false; this.pendingJobs = 0; this.tail = Promise.resolve(); this.spawn = spawnImpl; this.startupTimeout = startupTimeout; this.jobTimeout = jobTimeout; this.worker = null; this.workerStatus = 'stopped'; this.completedJobs = 0; this.closed = false;
    for (const name of readdirSync(root)) if (/^enrollment-[a-f0-9-]{36}\.image$/.test(name)) unlinkSync(join(root, name));
  }
  galleryRevision() { return createHash('sha256').update(JSON.stringify(this.people.map(({ id, revision }) => [id, revision]))).digest('hex'); }
  state() { return { modelsReady: ['yunet', 'sface', 'yolox'].every(name => existsSync(join(this.projectRoot, 'ai', 'models', `${name}.onnx`))), busy: this.busy, pendingJobs: this.pendingJobs, worker: { status: this.workerStatus, completedJobs: this.completedJobs }, maxTemplates: MAX_FACE_TEMPLATES, people: this.people.map(({ id, name, at, templates }) => ({ id, name, at, templateCount: templates.length, arcFaceTemplateCount: templates.filter(template => validEmbedding(template.arcEmbedding, 512)).length, templates: templates.map(({ id, at }) => ({ id, at })) })) }; }
  enqueue(operation) {
    if (this.closed) return Promise.reject(new Error('Lokale KI wird beendet.'));
    if (this.pendingJobs >= 50) return Promise.reject(new Error('Zu viele ausstehende Auswertungen. Bitte warten.'));
    this.pendingJobs++;
    const result = this.tail.then(async () => { this.busy = true; try { return await operation(); } finally { this.busy = false; this.pendingJobs--; this.idleWorker(); } });
    this.tail = result.catch(() => {}); return result;
  }
  idleWorker() {
    const child = this.worker?.child; if (!child) return;
    child.unref(); child.stdin.unref?.(); child.stdout.unref?.();
  }
  refWorker() { const child = this.worker.child; child.ref(); child.stdin.ref?.(); child.stdout.ref?.(); }
  async ensureWorker() {
    if (this.worker) { this.refWorker(); return this.worker.ready; }
    const python = process.env.AI_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
    const args = [...(process.platform === 'win32' && !process.env.AI_PYTHON ? ['-3.12'] : []), '-u', join(this.projectRoot, 'ai', 'analyze.py'), '--worker'];
    const child = this.spawn(python, args, { windowsHide: true, env: { ...process.env, ...this.pythonEnv, OPENCV_IO_MAX_IMAGE_PIXELS: '16777216' }, stdio: ['pipe', 'pipe', 'ignore'] });
    let accept, reject;
    const job = { child, buffer: '', pending: null, initialized: false, ready: new Promise((resolve, fail) => { accept = resolve; reject = fail; }) }; this.worker = job; this.workerStatus = 'starting';
    job.fail = message => {
      if (job.failed) return; job.failed = true; clearTimeout(job.startupTimer); clearTimeout(job.pending?.timer);
      reject(new Error(message)); job.pending?.reject(new Error(message)); job.pending = null;
      if (this.worker === job) { this.worker = null; this.workerStatus = this.closed ? 'stopped' : 'error'; }
      child.kill(); child.stdin.destroy(); child.stdout.destroy(); child.unref();
    };
    job.startupTimer = setTimeout(() => job.fail('Lokaler KI-Worker startet nicht rechtzeitig.'), this.startupTimeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (job.failed) return;
      job.buffer += chunk;
      if (Buffer.byteLength(job.buffer) > 1_000_000) { job.fail('KI-Ausgabe nicht lesbar oder zu groß.'); return; }
      let at;
      while ((at = job.buffer.indexOf('\n')) !== -1 && !job.failed) {
        const line = job.buffer.slice(0, at); job.buffer = job.buffer.slice(at + 1);
        let message; try { message = JSON.parse(line); } catch { job.fail('KI-Ausgabe nicht lesbar oder zu groß.'); return; }
        if (!job.initialized) {
          if (message.ready !== true || message.protocol !== 1) { job.fail('KI-Worker-Protokoll ungültig.'); return; }
          job.initialized = true; clearTimeout(job.startupTimer); this.workerStatus = 'ready'; accept();
        } else {
          if (!job.pending || message.id !== job.pending.id || !message.result || typeof message.result !== 'object') { job.fail('KI-Worker-Protokoll ungültig.'); return; }
          const pending = job.pending; job.pending = null; clearTimeout(pending.timer);
          if (message.result.error) pending.reject(new Error(typeof message.result.error === 'string' ? message.result.error.slice(0, 300) : 'Lokale KI nicht verfügbar.'));
          else { this.completedJobs++; const { worker, ...result } = message.result; job.diagnostics = worker; pending.resolve(result); }
        }
      }
    });
    child.once('error', () => job.fail('Python 3.12 mit OpenCV nicht gefunden.'));
    child.once('close', () => { if (!job.stopping) job.fail('Lokaler KI-Worker wurde unterbrochen. Der nächste Auftrag startet ihn neu.'); });
    child.stdin.on('error', () => job.fail('Lokaler KI-Worker wurde unterbrochen. Der nächste Auftrag startet ihn neu.'));
    return job.ready;
  }
  async request(data) {
    await this.ensureWorker(); const job = this.worker;
    if (!job || job.failed) throw new Error('Lokaler KI-Worker nicht verfügbar.');
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => job.fail('KI-Auswertung hat zu lange gedauert.'), this.jobTimeout);
      job.pending = { id, resolve, reject, timer };
      job.child.stdin.write(JSON.stringify({ id, data }) + '\n', error => { if (error) job.fail('Lokaler KI-Worker wurde unterbrochen. Der nächste Auftrag startet ihn neu.'); });
    });
  }
  run(data) { return this.enqueue(() => this.request(data)); }
  checkFaceWorker(config) {
    if (!config.url || !config.token) throw Error('Worker-Adresse und Token zuerst eintragen.');
    return this.run({ mode: 'check-face-worker', faceWorker: config });
  }
  analyze(path, threshold, profile = { personDetection: true, faceRecognition: true }) {
    return this.enqueue(async () => {
      const wantsWorker = profile.faceRecognition && !profile.privacyZones?.length && ['network', 'network-arcface'].includes(profile.faceEngine);
      const config = wantsWorker ? await this.faceWorker() : null;
      const useWorker = Boolean(config?.enabled && (profile.faceEngine === 'network' || config.arcface));
      const arcface = useWorker && profile.faceEngine === 'network-arcface';
      const known = !profile.faceRecognition ? [] : this.people.map(({ id, name, templates }) => ({
        id, name, templates: templates.map(({ embedding, arcEmbedding }) => ({ embedding, ...(arcface && { arcEmbedding }) })),
      }));
      return this.request({ mode: 'analyze', path, threshold, personDetection: profile.personDetection, faceRecognition: profile.faceRecognition,
        faceEngine: profile.faceEngine, privacyZones: profile.privacyZones, galleryRevision: this.galleryRevision(), arcface, known,
        ...(useWorker && { faceWorker: config }) });
    });
  }
  enroll({ name, image, personId, allowArcFace = true }) {
    if (personId !== undefined && (typeof personId !== 'string' || !this.people.some(person => person.id === personId))) return Promise.reject(new Error('Person nicht gefunden.'));
    if (personId === undefined && (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\x00-\x1f\x7f]/.test(name))) return Promise.reject(new Error('Name mit höchstens 60 Zeichen angeben.'));
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6_000_000) return Promise.reject(new Error('JPEG-, PNG- oder WebP-Foto bis 4 MB auswählen.'));
    const bytes = Buffer.from(image.split(',')[1], 'base64');
    if (bytes.length > 4 * 1024 * 1024) return Promise.reject(new Error('Foto ist größer als 4 MB.'));
    return this.enqueue(async () => {
      const existing = personId ? this.people.find(person => person.id === personId) : this.people.find(person => person.name.toLocaleLowerCase('de-DE') === name.trim().toLocaleLowerCase('de-DE'));
      if (personId && !existing) throw new Error('Person nicht gefunden.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const config = allowArcFace ? await this.faceWorker() : null;
      const arcface = Boolean(config?.enabled && config.arcface);
      const matching = existing?.templates.find(template => template.hash === hash);
      if (matching && (!arcface || validEmbedding(matching.arcEmbedding, 512))) return { id: existing.id, name: existing.name, templateCount: existing.templates.length, duplicate: true };
      if (!matching && existing?.templates.length >= MAX_FACE_TEMPLATES) throw new Error('Maximal 12 Gesichtsvorlagen pro Person. Zuerst eine alte Vorlage entfernen.');
      if (!existing && this.people.length >= 100) throw new Error('Maximal 100 bekannte Gesichter.');
      const temporary = join(this.root, `enrollment-${randomUUID()}.image`); await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      try {
        const { embedding, arcEmbedding } = await this.request({ mode: 'enroll', path: temporary, arcface, ...(arcface && { faceWorker: config }) });
        if (!validEmbedding(embedding, 128) || arcface && !validEmbedding(arcEmbedding, 512)) throw new Error('Ungültige Gesichtsvorlage vom KI-Worker.');
        const at = new Date().toISOString(), entry = existing || { id: randomUUID(), name: name.trim(), templates: [] };
        if (matching) matching.arcEmbedding = arcEmbedding;
        else entry.templates.push({ id: randomUUID(), at, hash, embedding, ...(arcface && { arcEmbedding }) });
        entry.at = at; entry.revision = randomUUID();
        if (!existing) this.people.push(entry);
        writeJson(this.file, this.people); this.onGalleryChange?.();
        return { id: entry.id, name: entry.name, templateCount: entry.templates.length };
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
  assertGalleryIdle() { if (this.pendingJobs || this.busy) throw new Error('Gesichtsdaten erst nach laufender KI-Auswertung ändern.'); }
  removeTemplate(personId, templateId) {
    this.assertGalleryIdle(); const person = this.people.find(person => person.id === personId);
    if (!person || !person.templates.some(template => template.id === templateId)) throw new Error('Gesichtsvorlage nicht gefunden.');
    if (person.templates.length <= 1) throw new Error('Die letzte Vorlage bleibt erhalten. Nutze Person vergessen, um die Person vollständig zu entfernen.');
    person.templates = person.templates.filter(template => template.id !== templateId); person.at = new Date().toISOString(); person.revision = randomUUID(); writeJson(this.file, this.people); this.onGalleryChange?.();
  }
  remove(id) { this.assertGalleryIdle(); this.people = this.people.filter(person => person.id !== id); writeJson(this.file, this.people); this.onGalleryChange?.(); }
  async close() {
    this.closed = true; await this.tail; const job = this.worker; if (!job) { this.workerStatus = 'stopped'; return; }
    job.stopping = true; this.refWorker();
    await new Promise(resolve => { const timer = setTimeout(() => job.child.kill(), 2000); job.child.once('close', () => { clearTimeout(timer); resolve(); }); job.child.stdin.end(); });
    if (this.worker === job) this.worker = null; this.workerStatus = 'stopped';
  }
}
