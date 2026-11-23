import { join, isAbsolute, resolve } from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from './storage.mjs';
import { normalizeWebhook } from './discord.mjs';
import { normalizeOllamaUrl, normalizeProviderUrl, validModel, localModel } from './summary-providers.mjs';

import { PROVIDERS, providerInfo } from './provider-catalog.mjs';
import { normalizeZones } from './privacy-zones.mjs';
import { environmentFaceWorker, updateFaceWorker } from './face-worker-config.mjs';

function providerConfig(info, previous, input) {
  const target = { ...previous };
  if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw new Error('KI-Freigabe ungültig.'); target.enabled = input.enabled; }
  if (input.model !== undefined) { if (input.model !== '' && !(info.id === 'ollama' ? localModel(input.model) : validModel(input.model))) throw new Error('Gültigen Modellnamen wählen; Ollama benötigt ein lokales Bildmodell.'); target.model = input.model; }
  if (input.baseUrl !== undefined) target.baseUrl = normalizeProviderUrl(info.id, input.baseUrl);
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string' || input.apiKey.length > 2048 || /\s/.test(input.apiKey)) throw new Error('KI-API-Schlüssel ungültig.');
    if (input.apiKey && info.id !== 'ollama') target.apiKey = input.apiKey;
  }
  if (input.clearKey === true) { target.apiKey = ''; target.enabled = false; }
  if (target.enabled && (!target.model || (info.keyRequired && !target.apiKey) || (info.customUrl && !target.baseUrl))) throw new Error('Modell und gegebenenfalls API-Schlüssel vor der Freigabe eintragen.');
  return target;
}

export class Settings {
  constructor(storage) {
    this.file = join(storage.root, 'settings.json');
    this.value = { clipsDirectory: storage.clips, automaticCameras: [], cameraProfiles: {}, profilesInitialized: false, aiEnabled: false, faceThreshold: 0.50, cloud: { enabled: false, endpoint: '', bucket: '', region: 'auto', prefix: 'tuerwache/', accessKeyId: '', secretAccessKey: '' }, ...readJson(this.file, {}) };
    this.value.discord = { enabled: false, webhookUrl: '', personCooldownSeconds: 60, ...this.value.discord };
    const summaries = this.value.summaries || {};
    this.value.summaries = { openaiDailyLimit: 20, ...summaries, ollama: { enabled: false, baseUrl: 'http://127.0.0.1:11434', model: '', ...summaries.ollama }, openai: { enabled: false, model: '', apiKey: '', ...summaries.openai } };
    for (const info of PROVIDERS) if (!['ollama', 'openai'].includes(info.id)) this.value.summaries[info.id] = { enabled: false, model: '', apiKey: '', baseUrl: info.baseUrl, ...summaries[info.id] };
    this.value.summaries.profiles = summaries.profiles || {};
  }
  resolveSummary(id) {
    if (providerInfo(id)) return { ...this.value.summaries[id], provider: id };
    if (typeof id === 'string' && /^model_[a-f0-9-]{36}$/.test(id) && Object.hasOwn(this.value.summaries.profiles, id)) return this.value.summaries.profiles[id];
    return null;
  }
  summaryModels() {
    return [...PROVIDERS.filter(info => { const config = this.value.summaries[info.id]; return config.model || config.enabled || config.apiKey; }).map(info => ({ id: info.id, ...this.resolveSummary(info.id) })), ...Object.entries(this.value.summaries.profiles).map(([id, config]) => ({ id, ...config }))].map(({ apiKey, ...config }) => ({ ...config, name: config.name || `${providerInfo(config.provider)?.name || config.provider} · ${config.model || 'ohne Modell'}`, keySet: Boolean(apiKey) }));
  }
  saveModel(input) {
    if (this.saving) throw new Error('Einstellungen werden gerade gespeichert. Bitte kurz warten.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('KI-Modellkonfiguration ungültig.');
    const id = input.id || `model_${randomUUID()}`, existing = this.resolveSummary(id), info = providerInfo(input.provider);
    if (input.id && !existing) throw new Error('KI-Modell nicht gefunden.');
    if (!info || (providerInfo(id) && id !== info.id)) throw new Error('KI-Anbieter ungültig.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\x00-\x1f\x7f]/.test(input.name)) throw new Error('Modellbezeichnung mit 1 bis 80 Zeichen eingeben.');
    if (!input.model) throw new Error('Modellnamen eingeben.');
    const previous = existing?.provider === info.id ? existing : { enabled: false, model: '', apiKey: '', baseUrl: info.baseUrl };
    const config = { ...providerConfig(info, previous, input), provider: info.id, name: input.name.trim() };
    if (providerInfo(id)) this.value.summaries[id] = config; else {
      if (!existing && Object.keys(this.value.summaries.profiles).length >= 50) throw new Error('Maximal 50 zusätzliche KI-Modelle.');
      this.value.summaries.profiles[id] = config;
    }
    writeJson(this.file, this.value); return id;
  }
  removeModel(id) {
    if (this.saving) throw new Error('Einstellungen werden gerade gespeichert. Bitte kurz warten.');
    if (!this.resolveSummary(id)) throw new Error('KI-Modell nicht gefunden.');
    if (Object.values(this.value.cameraProfiles).some(profile => profile.summaryProvider === id)) throw new Error('Dieses Modell ist noch einer Kamera zugeordnet. Zuerst im Kamera-Profil ein anderes Modell oder Aus wählen.');
    const info = providerInfo(id);
    if (info) this.value.summaries[id] = { enabled: false, model: '', apiKey: '', baseUrl: info.baseUrl };
    else delete this.value.summaries.profiles[id];
    writeJson(this.file, this.value);
  }
  profile(cameraId) {
    const legacy = !this.value.profilesInitialized;
    return { monitoring: legacy, recordMotion: legacy && this.value.automaticCameras.includes(cameraId), recordDing: legacy && this.value.automaticCameras.includes(cameraId), recordingSeconds: 10, recordingCooldownSeconds: 60, extendRecording: false, personDetection: legacy && this.value.aiEnabled, faceRecognition: legacy && this.value.aiEnabled, cloudUpload: legacy && this.value.cloud.enabled, discordDing: false, discordDingClip: false, discordMotionClip: false, discordPerson: false, discordPersonImage: false, discordSummary: false, discordSummaryImage: false, summaryProvider: 'off', sceneContext: '', ...this.value.cameraProfiles[cameraId] };
  }
  registerCameras(ids) {
    if (!ids.length) return;
    let changed = !this.value.profilesInitialized;
    for (const id of ids) if (!Object.hasOwn(this.value.cameraProfiles, id)) { this.value.cameraProfiles[id] = this.profile(id); changed = true; }
    this.value.profilesInitialized = true;
    if (changed) { this.syncAutomatic(); writeJson(this.file, this.value); }
  }
  syncAutomatic() { this.value.automaticCameras = Object.entries(this.value.cameraProfiles).filter(([, p]) => p.monitoring && (p.recordMotion || p.recordDing)).map(([id]) => id); }
  updateProfile(cameraId, input) {
    if (this.saving) throw new Error('Einstellungen werden gerade gespeichert. Bitte kurz warten.');
    if (typeof cameraId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(cameraId) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Kamera-Profil ungültig.');
    const allowed = ['extendRecording', 'monitoring', 'recordMotion', 'recordDing', 'personDetection', 'faceRecognition', 'cloudUpload', 'discordDing', 'discordDingClip', 'discordMotionClip', 'discordPerson', 'discordPersonImage', 'discordSummary', 'discordSummaryImage'];
    const { privacyZones, faceEngine, ...settings } = input;
    if (faceEngine !== undefined && !['local', 'network', 'network-arcface'].includes(faceEngine)) throw Error('Gesichts-Engine ungültig.');
    if (Object.entries(settings).some(([key, value]) => key === 'summaryProvider' ? value !== 'off' && !this.resolveSummary(value) : key === 'sceneContext' ? typeof value !== 'string' || value.length > 400 : key === 'recordingSeconds' ? ![10, 20, 30, 45, 60].includes(value) : key === 'recordingCooldownSeconds' ? !Number.isInteger(value) || value < 10 || value > 3600 : !allowed.includes(key) || typeof value !== 'boolean')) throw new Error('Kamera-Funktionen oder Aufnahmezeiten ungültig.');
    const next = { ...this.profile(cameraId), ...settings, ...(faceEngine !== undefined && { faceEngine }), ...(privacyZones !== undefined && { privacyZones: normalizeZones(privacyZones) }) };
    this.value.cameraProfiles[cameraId] = next;
    this.syncAutomatic(); writeJson(this.file, this.value);
    return next;
  }
  faceWorker() {
    if (this.value.faceWorker) return { mode: 'external', ...this.value.faceWorker };
    const environment = environmentFaceWorker();
    if (environment.url) return { ...environment, mode: 'external' };
    return { mode: 'local', url: '', token: '', enabled: true, arcface: false, localOnly: true };
  }
  previewFaceWorker(input) { return updateFaceWorker(this.faceWorker(), input); }
  public() {
    const { accessKeyId, secretAccessKey, ...cloud } = this.value.cloud;
    const { webhookUrl, ...discord } = this.value.discord;
    const summaries = { openaiDailyLimit: this.value.summaries.openaiDailyLimit };
    for (const info of PROVIDERS) { const { apiKey, ...config } = this.value.summaries[info.id]; summaries[info.id] = { ...config, keySet: Boolean(apiKey) }; }
    summaries.profiles = Object.fromEntries(Object.entries(this.value.summaries.profiles).map(([id, { apiKey, ...config }]) => [id, { ...config, keySet: Boolean(apiKey) }]));
    const { mode, url, token, enabled, arcface } = this.faceWorker();
    return { ...this.value, cloud: { ...cloud, credentialsSet: Boolean(accessKeyId && secretAccessKey) }, discord: { ...discord, webhookSet: Boolean(webhookUrl) }, summaries,
      faceWorker: { mode, url, enabled, arcface, tokenSet: Boolean(token), fromEnvironment: !this.value.faceWorker && mode === 'external' } };
  }
  async update(input) {
    if (this.saving) throw new Error('Einstellungen werden gerade gespeichert. Bitte kurz warten.');
    this.saving = true;
    try { return await this.apply(input); } finally { this.saving = false; }
  }
  async apply(input) {
    const next = structuredClone(this.value);
    if (input.faceWorker !== undefined) next.faceWorker = this.previewFaceWorker(input.faceWorker);
    if (input.summaries !== undefined) {
      const config = input.summaries;
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('KI-Anbieter-Konfiguration ungültig.');
      if (config.openaiDailyLimit !== undefined) {
        if (!Number.isInteger(config.openaiDailyLimit) || config.openaiDailyLimit < 1 || config.openaiDailyLimit > 1000) throw new Error('Tageslimit muss zwischen 1 und 1000 Auswertungen liegen.');
        next.summaries.openaiDailyLimit = config.openaiDailyLimit;
      }
      if (Object.keys(config).some(key => key !== 'openaiDailyLimit' && !providerInfo(key))) throw new Error('KI-Anbieter unbekannt.');
      for (const info of PROVIDERS) if (config[info.id] !== undefined) {
        const provider = info.id;
        const inputProvider = config[provider], target = next.summaries[provider];
        if (!inputProvider || typeof inputProvider !== 'object' || Array.isArray(inputProvider)) throw new Error('KI-Anbieter-Konfiguration ungültig.');
        if (inputProvider.enabled !== undefined) { if (typeof inputProvider.enabled !== 'boolean') throw new Error('KI-Freigabe ungültig.'); target.enabled = inputProvider.enabled; }
        if (inputProvider.model !== undefined) { if (inputProvider.model !== '' && !(provider === 'ollama' ? localModel(inputProvider.model) : validModel(inputProvider.model))) throw new Error('Gültigen lokalen Modellnamen ohne Cloud-Kennung für Ollama bzw. gültigen Modellnamen wählen.'); target.model = inputProvider.model; }
        if (provider === 'ollama' && inputProvider.baseUrl !== undefined) target.baseUrl = normalizeOllamaUrl(inputProvider.baseUrl);
        if (provider !== 'ollama' && inputProvider.baseUrl !== undefined) target.baseUrl = normalizeProviderUrl(provider, inputProvider.baseUrl);
        if (provider !== 'ollama' && inputProvider.apiKey !== undefined) {
          if (typeof inputProvider.apiKey !== 'string' || inputProvider.apiKey.length > 2048 || /\s/.test(inputProvider.apiKey)) throw new Error('KI-API-Schlüssel ungültig.');
          if (inputProvider.apiKey) target.apiKey = inputProvider.apiKey;
        }
        if (provider !== 'ollama' && inputProvider.clearKey === true) { target.apiKey = ''; target.enabled = false; }
        if (target.enabled && (!target.model || (info.keyRequired && !target.apiKey) || (info.customUrl && !target.baseUrl))) throw new Error('Modell und gegebenenfalls API-Schlüssel vor der Freigabe eintragen.');
      }
    }
    if (input.discord !== undefined) {
      const discord = input.discord;
      if (!discord || typeof discord !== 'object' || Array.isArray(discord)) throw new Error('Discord-Konfiguration ungültig.');
      if (discord.enabled !== undefined) { if (typeof discord.enabled !== 'boolean') throw new Error('Discord-Freigabe ungültig.'); next.discord.enabled = discord.enabled; }
      if (discord.webhookUrl !== undefined) {
        if (typeof discord.webhookUrl !== 'string' || discord.webhookUrl.length > 512) throw new Error('Discord-Webhook ungültig.');
        if (discord.webhookUrl.trim()) next.discord.webhookUrl = normalizeWebhook(discord.webhookUrl.trim());
      }
      if (discord.personCooldownSeconds !== undefined) {
        if (!Number.isInteger(discord.personCooldownSeconds) || discord.personCooldownSeconds < 10 || discord.personCooldownSeconds > 3600) throw new Error('Discord-Pause muss zwischen 10 und 3600 Sekunden liegen.');
        next.discord.personCooldownSeconds = discord.personCooldownSeconds;
      }
      if (discord.clearWebhook === true) { next.discord.webhookUrl = ''; next.discord.enabled = false; }
      if (next.discord.enabled && !next.discord.webhookUrl) throw new Error('Discord-Webhook eingeben, bevor der Versand freigegeben wird.');
    }
    if (input.clipsDirectory !== undefined) {
      if (typeof input.clipsDirectory !== 'string' || input.clipsDirectory.length > 512 || !isAbsolute(input.clipsDirectory)) throw new Error('Absoluten Speicherpfad auf dem Server angeben.');
      const directory = resolve(input.clipsDirectory);
      await mkdir(directory, { recursive: true });
      const probe = join(directory, `.tuerwache-write-${randomUUID()}`);
      const file = await open(probe, 'wx', 0o600); await file.close(); await unlink(probe);
      next.clipsDirectory = directory;
    }
    if (input.aiEnabled !== undefined) { if (typeof input.aiEnabled !== 'boolean') throw new Error('KI-Einstellung ungültig.'); next.aiEnabled = input.aiEnabled; }
    if (input.faceThreshold !== undefined) {
      if (!Number.isFinite(input.faceThreshold) || input.faceThreshold < 0.363 || input.faceThreshold > 0.9) throw new Error('Gesichtsschwelle muss zwischen 0,363 und 0,9 liegen.');
      next.faceThreshold = input.faceThreshold;
    }
    if (input.cloud) {
      const cloud = input.cloud;
      for (const key of ['endpoint', 'bucket', 'region', 'prefix', 'accessKeyId', 'secretAccessKey']) {
        if (cloud[key] !== undefined) {
          if (typeof cloud[key] !== 'string' || cloud[key].length > 1024) throw new Error('Cloud-Konfiguration ungültig.');
          // Empty password fields preserve saved credentials. Explicit clear is separate.
          if (!['accessKeyId', 'secretAccessKey'].includes(key) || cloud[key]) next.cloud[key] = cloud[key].trim();
        }
      }
      if (cloud.enabled !== undefined) { if (typeof cloud.enabled !== 'boolean') throw new Error('Cloud-Einstellung ungültig.'); next.cloud.enabled = cloud.enabled; }
      if (cloud.clearCredentials === true) { next.cloud.accessKeyId = ''; next.cloud.secretAccessKey = ''; next.cloud.enabled = false; }
      if (next.cloud.endpoint) {
        let url; try { url = new URL(next.cloud.endpoint); } catch { throw new Error('S3-Endpunkt ungültig.'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('S3-Endpunkt als HTTPS-Adresse ohne Pfad angeben.');
        next.cloud.endpoint = url.origin;
      }
      if (next.cloud.bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(next.cloud.bucket)) throw new Error('Bucket-Name ungültig.');
      if (!/^[a-zA-Z0-9_/-]{0,160}$/.test(next.cloud.prefix) || next.cloud.prefix.includes('..')) throw new Error('Cloud-Präfix ungültig.');
      if (next.cloud.enabled && (!next.cloud.endpoint || !next.cloud.bucket || !next.cloud.accessKeyId || !next.cloud.secretAccessKey || !next.cloud.region)) throw new Error('Endpunkt, Bucket, Region und beide S3-Schlüssel ausfüllen.');
    }
    // Camera discovery may finish while the directory write probe awaits I/O.
    next.cameraProfiles = this.value.cameraProfiles;
    next.profilesInitialized = this.value.profilesInitialized;
    next.automaticCameras = this.value.automaticCameras;
    writeJson(this.file, next); this.value = next;
    return this.public();
  }
  automatic(cameraId, enabled) {
    if (this.saving) throw new Error('Einstellungen werden gerade gespeichert. Bitte kurz warten.');
    if (enabled && !this.profile(cameraId).monitoring) throw new Error('Überwachung für diese Kamera zuerst einschalten.');
    this.updateProfile(cameraId, { recordMotion: enabled, recordDing: enabled });
  }
}
