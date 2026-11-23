import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFaceWorker } from '../scripts/start-face-worker.mjs';
import { AIService } from './ai-service.mjs';
import { ArcFaceModel } from './arcface-model.mjs';

export class ManagedFaceWorker {
  constructor(projectRoot, dataRoot) {
    this.projectRoot = projectRoot;
    this.arcFaceModel = new ArcFaceModel(projectRoot, dataRoot);
  }

  async start() {
    const directory = await mkdtemp(join(tmpdir(), 'tuerwache-integrated-worker-'));
    const ai = new AIService(directory, this.projectRoot, { jobTimeout: 15000 });
    try {
      if (!ai.state().modelsReady) throw Error('Für den integrierten Worker zuerst die OpenCV-Modelle installieren.');
      const token = randomBytes(32).toString('hex');
      const server = createFaceWorker({ run: async data => {
        if (data.model !== 'arcface-w600k-r50-v1') return ai.run(data);
        return ai.run({ ...data, arcFaceModelPath: await this.arcFaceModel.verify() });
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

  async connection(config) {
    if (config.mode !== 'local') return config;
    this.running ??= this.start().catch(error => { this.running = null; throw error; });
    const { url, token } = await this.running;
    return { ...config, url, token };
  }

  async close() {
    await this.arcFaceModel.close();
    const worker = await this.running?.catch(() => null);
    if (!worker) return;
    const closed = new Promise(done => worker.server.close(done));
    worker.server.closeAllConnections();
    await Promise.all([closed, worker.ai.close()]);
    await rmdir(worker.directory);
    this.running = null;
  }
}
