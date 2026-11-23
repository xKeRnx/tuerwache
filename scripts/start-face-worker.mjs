import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIService } from '../src/ai-service.mjs';

const sface = 'sface-v1';
const arcface = 'arcface-w600k-r50-v1';
const arcfaceSha256 = '4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43';
const limit = 2_000_000;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyArcFaceModel(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== arcfaceSha256) throw Error('FACE_WORKER_ARCFACE_MODEL muss auf das geprüfte w600k_r50.onnx aus buffalo_l zeigen.');
}

export function createFaceWorker(ai, token, tls, { enableArcFace = false } = {}) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256 || !/^[\x21-\x7e]+$/.test(token)) throw Error('FACE_WORKER_TOKEN benötigt 32–256 Zeichen ohne Leerzeichen.');
  const authorization = Buffer.from(`Bearer ${token}`);
  let busy = false;
  const handler = async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    const header = Buffer.from(request.headers.authorization || '');
    if (header.length !== authorization.length || !timingSafeEqual(header, authorization)) { send(401, { error: 'Freigabe erforderlich.' }); return; }
    if (request.method !== 'POST' || request.url !== '/embed') { send(404, { error: 'Nicht gefunden.' }); return; }
    if (busy) { send(429, { error: 'Gesichts-Worker ausgelastet.' }); return; }
    if (Number(request.headers['content-length']) > limit) { send(413, { error: 'Anfrage zu groß.' }); return; }
    busy = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) { request.destroy(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const model = body?.model;
      const maxCrops = model === sface ? 64 : model === arcface && enableArcFace ? 8 : 0;
      if (!maxCrops || !Array.isArray(body.images) || !body.images.length || body.images.length > maxCrops || body.images.some(image => typeof image !== 'string' || image.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image))) {
        send(400, { error: 'Modell oder Gesichtsausschnitte ungültig.' }); return;
      }
      const result = await ai.run({ mode: 'embed', model, images: body.images });
      send(200, { model, embeddings: result.embeddings });
    } catch { if (!response.destroyed && !response.headersSent) send(400, { error: 'Gesichtsausschnitte konnten nicht verarbeitet werden.' }); }
    finally { busy = false; }
  };
  const options = { maxHeaderSize: 4096, requestTimeout: 15000, headersTimeout: 10000 };
  const server = tls ? createSecureServer({ ...options, minVersion: 'TLSv1.2', ...tls }, handler) : createServer(options, handler);
  server.setTimeout(15000, socket => socket.destroy());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.FACE_WORKER_HOST || '127.0.0.1';
  const port = Number(process.env.FACE_WORKER_PORT || 3211);
  const { FACE_WORKER_CERT, FACE_WORKER_KEY, FACE_WORKER_TOKEN } = process.env;
  const arcFacePath = process.env.FACE_WORKER_ARCFACE_MODEL;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('FACE_WORKER_PORT ungültig.');
  const tls = FACE_WORKER_CERT && FACE_WORKER_KEY ? { cert: readFileSync(FACE_WORKER_CERT), key: readFileSync(FACE_WORKER_KEY) } : undefined;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !tls) throw Error('Im Heimnetz FACE_WORKER_CERT und FACE_WORKER_KEY für HTTPS setzen.');
  if (arcFacePath) await verifyArcFaceModel(arcFacePath);
  const data = await mkdtemp(join(tmpdir(), 'tuerwache-face-worker-'));
  const ai = new AIService(data, projectRoot, { jobTimeout: 15000 });
  const shutdown = async () => { await ai.close(); await rm(data, { recursive: true, force: true }); };
  try {
    if (!ai.state().modelsReady) throw Error('OpenCV-Modelle zuerst installieren.');
    const server = createFaceWorker(ai, FACE_WORKER_TOKEN, tls, { enableArcFace: Boolean(arcFacePath) });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); shutdown().finally(() => process.exit()); });
    server.listen(port, host);
    await new Promise((accept, reject) => { server.once('listening', accept); server.once('error', reject); });
    console.log(`Gesichts-Worker läuft auf ${tls ? 'HTTPS' : 'HTTP'} an Port ${port}.`);
  } catch (error) { await shutdown(); throw error; }
}
