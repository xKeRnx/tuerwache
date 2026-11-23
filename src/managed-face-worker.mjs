import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFaceWorker, verifyArcFaceModel } from '../scripts/start-face-worker.mjs';
import { AIService } from './ai-service.mjs';

export class ManagedFaceWorker {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.model = resolve(process.env.FACE_WORKER_ARCFACE_MODEL || join(projectRoot, 'ai', 'models', 'w600k_r50.onnx'));
  }

  async start() {
    const directory = await mkdtemp(join(tmpdir(), 'tuerwache-integrated-worker-'));
    const ai = new AIService(directory, this.projectRoot, { jobTimeout: 15000, pythonEnv: { FACE_WORKER_ARCFACE_MODEL: this.model } });
    try {
      if (!ai.state().modelsReady) throw Error('Für den integrierten Worker zuerst die OpenCV-Modelle installieren.');
      const token = randomBytes(32).toString('hex');
      const server = createFaceWorker({ run: async data => {
        if (data.model === 'arcface-w600k-r50-v1') await this.checkArcFace();
        return ai.run(data);
      } }, token, undefined, { enableArcFace: true });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      server.unref();
      return { server, ai, directory, token, url: `http://127.0.0.1:${server.address().port}` };
    } catch (error) {
      await ai.close();
      await rmdir(directory);
      throw error;
    }
  }

  checkArcFace() {
    this.verifiedModel ??= verifyArcFaceModel(this.model).catch(() => {
      this.verifiedModel = null;
      throw Error('Für ArcFace das geprüfte Modell w600k_r50.onnx im Modellordner hinterlegen.');
    });
    return this.verifiedModel;
  }

  async connection(config) {
    if (config.mode !== 'local') return config;
    this.running ??= this.start().catch(error => { this.running = null; throw error; });
    const { url, token } = await this.running;
    return { ...config, url, token };
  }

  async close() {
    const worker = await this.running?.catch(() => null);
    if (!worker) return;
    const closed = new Promise(done => worker.server.close(done));
    worker.server.closeAllConnections();
    await Promise.all([closed, worker.ai.close()]);
    await rmdir(worker.directory);
    this.running = null;
  }
}
