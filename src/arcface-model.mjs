import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyArcFaceModel } from '../scripts/start-face-worker.mjs';
import { pythonInvocation } from './ai-service.mjs';

const run = promisify(execFile);
const name = 'w600k_r50.onnx';
const missing = 'ArcFace fehlt. Lade das Modell unter KI-Anbieter → Gesichts-Worker herunter.';
const invalid = 'Die ArcFace-Datei konnte nicht geprüft werden. Lade das Modell erneut herunter oder prüfe den konfigurierten Pfad.';

export class ArcFaceModel {
  constructor(projectRoot, dataRoot) {
    this.projectRoot = projectRoot;
    this.directory = join(dataRoot, 'models');
    this.installed = join(this.directory, name);
    this.manual = join(projectRoot, 'ai', 'models', name);
    this.configured = process.env.FACE_WORKER_ARCFACE_MODEL ? resolve(process.env.FACE_WORKER_ARCFACE_MODEL) : null;
  }

  modelPath() {
    return this.configured ?? (existsSync(this.installed) || !existsSync(this.manual) ? this.installed : this.manual);
  }

  status() {
    const path = this.modelPath();
    const present = existsSync(path);
    const state = this.pending ? 'downloading' : this.failure ? 'error' : this.verified?.path === path && this.verified.valid && present ? 'ready' : present ? 'found' : 'missing';
    return { state, canDownload: !this.configured && ['missing', 'error'].includes(state) };
  }

  async verify() {
    const path = this.modelPath();
    try {
      const details = await stat(path);
      if (!details.isFile()) throw new Error(invalid);
      const key = `${path}|${details.size}|${details.mtimeMs}|${details.ctimeMs}`;
      if (this.verified?.key !== key) {
        const entry = { path, key, check: verifyArcFaceModel(path).then(() => { entry.valid = true; }) };
        this.verified = entry;
      }
      await this.verified.check;
      this.failure = false;
      return path;
    } catch (error) {
      this.verified = null;
      this.failure = error.code !== 'ENOENT';
      throw new Error(error.code === 'ENOENT' && !this.configured ? missing : invalid);
    }
  }

  download() {
    if (this.pending) return;
    if (!this.status().canDownload) throw new Error('Für diese ArcFace-Konfiguration ist kein Download erforderlich oder verfügbar.');
    this.failure = false;
    this.cancel = new AbortController();
    this.pending = this.install(this.cancel.signal).catch(() => { this.failure = true; }).finally(() => { this.pending = null; });
  }

  async install(signal) {
    await mkdir(this.directory, { recursive: true });
    const stage = await mkdtemp(join(this.directory, '.arcface-'));
    const stagedModel = join(stage, name);
    try {
      const [python, prefix] = pythonInvocation();
      const download = run(python, [...prefix, join(this.projectRoot, 'ai', 'download-arcface.py'), stage], { signal, timeout: 600_000, windowsHide: true });
      const closed = new Promise(done => download.child.once('close', done));
      try { await download; } finally { await closed; }
      await verifyArcFaceModel(stagedModel);
      signal.throwIfAborted();
      await rename(stagedModel, this.installed);
      await this.verify();
    } finally {
      await Promise.all([stagedModel, join(stage, 'buffalo_l.zip')].map(file => unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; })));
      await rmdir(stage);
    }
  }

  async close() {
    this.cancel?.abort();
    await this.pending;
  }
}
