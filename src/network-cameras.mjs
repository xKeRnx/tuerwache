import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cameraCredentials, cameraUrl } from './camera-endpoint.mjs';
import { discoverOnvif, onvifMedia } from './onvif.mjs';
import { NetworkStream } from './network-stream.mjs';
import { readJson, writeJson } from './storage.mjs';
import { TotpVault } from './totp.mjs';

const validId = /^net-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const scratch = /^(?:clip|stream)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const rtspInput = address => ['-rtsp_transport', 'tcp', '-timeout', '8000000',
  '-protocol_whitelist', 'rtsp,rtsps,tcp,tls,rtp,udp', '-i', address];

export class NetworkCameras {
  constructor(service) {
    this.service = service;
    this.file = join(service.storage.root, 'network-cameras.json');
    this.root = join(service.storage.root, 'network-buffer');
    this.saved = readJson(this.file, []);
    this.cameras = new Map(this.saved.filter(entry => validId.test(entry.id)).map(entry => [entry.id, this.camera(entry)]));
  }
  get vault() {
    const users = readJson(join(this.service.storage.root, 'users.json'), []);
    return this._vault ??= new TotpVault(this.service.storage.root,
      !this.saved.length && !users.some(user => user.totp || user.pendingTotp));
  }
  camera(entry) {
    let stream, secretFailed = false;
    try {
      const address = this.vault.open(entry.address);
      stream = new NetworkStream(this.root, rtspInput(address), {
        convert: entry.convert,
        motionInput: entry.motionAddress ? rtspInput(this.vault.open(entry.motionAddress)) : undefined,
        motion: receivedAtMs => {
          if (this.service.features?.settings.profile(entry.id).recordMotion) {
            this.service.onCameraEvent(camera, 'motion', { receivedAtMs });
          }
        },
      });
    } catch { secretFailed = true; }
    const camera = {
      id: entry.id, name: entry.name, model: entry.kind === 'onvif' ? 'ONVIF' : 'RTSP', source: 'network',
      stream, preRoll: entry.preRoll,
      get isOffline() { return !stream?.ready; },
      get status() { return secretFailed ? 'credentials' : camera.limited ? 'limited' :
        stream.ready ? 'online' : stream.wanted ? 'connecting' : 'paused'; },
      startLiveCall: () => stream.live(),
      networkStatus: () => ({ id: entry.id, name: camera.name, kind: entry.kind,
        preRoll: camera.preRoll, convert: entry.convert, lowResolutionMotion: Boolean(entry.motionAddress), status: camera.status }),
    };
    return camera;
  }
  async start() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const paths = await readdir(this.root, { withFileTypes: true });
    await Promise.all(paths.filter(path => path.isDirectory() && scratch.test(path.name))
      .map(path => rm(join(this.root, path.name), { recursive: true, force: true }).catch(() => {})));
    this.started = !this.closed;
    if (this.cameras.size) this.service.syncRingConnections();
    this.reconcile();
  }
  reconcile() {
    if (!this.started || !this.service.features) return;
    let remaining = this.service.mediaHub.limit;
    for (const camera of this.cameras.values()) {
      const profile = this.service.features.settings.profile(camera.id);
      const enabled = profile.monitoring;
      camera.limited = enabled && remaining <= 0;
      const monitor = enabled && !camera.limited;
      camera.stream?.setMotion(profile.recordMotion);
      camera.stream?.setWanted(monitor);
      if (monitor && camera.stream) remaining--;
    }
  }
  async scan() {
    if (!this.scanTask) this.scanTask = discoverOnvif().finally(() => { this.scanTask = null; });
    return this.scanTask;
  }
  profiles(input) { return onvifMedia(input); }
  async add({ kind, name, address, username, password, profile, preRoll, motion, convert, monitoring, motionAddress = '' }) {
    if (!['rtsp', 'onvif'].includes(kind) || typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
        /[\x00-\x1f\x7f]/.test(name) || ![0, 5, 10, 15].includes(preRoll) ||
        [motion, convert, monitoring].some(value => typeof value !== 'boolean') || typeof motionAddress !== 'string' ||
        kind === 'onvif' && (typeof profile !== 'string' || !profile || profile.length > 128)) {
      throw Error('Name, Kameratyp oder Aufnahmeoptionen sind ungültig.');
    }
    const credentials = cameraCredentials(username, password);
    const selected = kind === 'onvif' ? await onvifMedia({ address, ...credentials, profile }) : address;
    const stream = await cameraUrl(selected, ['rtsp:', 'rtsps:']);
    if (kind === 'rtsp' && credentials.username) {
      stream.username = credentials.username;
      stream.password = credentials.password;
    }
    if (stream.password && !stream.username) throw Error('Kamera-Benutzername fehlt.');
    let motionStream;
    if (motionAddress.trim()) {
      motionStream = await cameraUrl(motionAddress.trim(), ['rtsp:', 'rtsps:']);
      if (!motionStream.username && motionStream.hostname === stream.hostname) {
        motionStream.username = stream.username;
        motionStream.password = stream.password;
      }
      if (motionStream.password && !motionStream.username) throw Error('Benutzername des Bewegungsstreams fehlt.');
    }
    const endpoint = url => { const copy = new URL(url); copy.username = copy.password = ''; return copy.href; };
    if (this.saved.length >= 32) throw Error('Es können bis zu 32 Netzwerkkameras hinterlegt werden.');
    if (this.saved.some(entry => endpoint(this.vault.open(entry.address)) === endpoint(stream))) {
      throw Error('Dieser Videostream wurde bereits hinzugefügt.');
    }
    const entry = { id: 'net-' + randomUUID(), name: name.trim(), address: this.vault.seal(stream.href),
      kind, preRoll, convert, ...(motionStream ? { motionAddress: this.vault.seal(motionStream.href) } : {}) };
    const next = [...this.saved, entry];
    writeJson(this.file, next);
    this.saved = next;
    this.cameras.set(entry.id, this.camera(entry));
    this.service.syncRingConnections();
    this.service.features.settings.updateProfile(entry.id, { monitoring, recordMotion: monitoring && motion });
    this.reconcile();
    return this.cameras.get(entry.id).networkStatus();
  }
  update(id, { name, preRoll }) {
    const camera = this.cameras.get(id);
    if (!camera || typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
        /[\x00-\x1f\x7f]/.test(name) || ![0, 5, 10, 15].includes(preRoll)) throw Error('Kameradaten sind ungültig.');
    const next = this.saved.map(entry => entry.id === id ? { ...entry, name: name.trim(), preRoll } : entry);
    writeJson(this.file, next);
    this.saved = next;
    camera.name = name.trim();
    camera.preRoll = preRoll;
    this.service.syncRingConnections();
    return camera.networkStatus();
  }
  remove(id) {
    const camera = this.cameras.get(id);
    if (!camera) throw Error('Netzwerkkamera nicht gefunden.');
    const next = this.saved.filter(entry => entry.id !== id);
    writeJson(this.file, next);
    this.saved = next;
    this.cameras.delete(id);
    camera.stream?.setWanted(false);
    this.service.syncRingConnections();
    this.reconcile();
  }
  state() { return [...this.cameras.values()].map(camera => camera.networkStatus()); }
  close() {
    this.closed = true;
    for (const camera of this.cameras.values()) camera.stream?.setWanted(false);
    return Promise.allSettled([...this.cameras.values()].map(camera => camera.stream?.loop));
  }
}
