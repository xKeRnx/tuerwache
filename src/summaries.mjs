import { confirmedSummaryIdentities, anonymousSceneText, appendConfirmedNames } from './identity-summary.mjs';
import { join } from 'node:path';
import { PROVIDERS, providerInfo, isLocalProvider } from './provider-catalog.mjs';
import { SummaryProviders } from './summary-providers.mjs';
import { readJson, writeJson } from './storage.mjs';
import { extractJpeg,verifyVideo } from './media.mjs';
import { summaryPositions, summaryFrameIndex } from './scene-sampling.mjs';
import {scenePrompt,validateSceneDescription} from './scene-description.mjs';

export class Summaries {
  constructor(features, providers = new SummaryProviders()) {
    this.features = features; this.providers = providers; this.tail = Promise.resolve(); this.count = 0; this.ollamaStatus = null;
    this.usageFile = join(features.service.storage.root, 'summary-usage.json'); this.usage = readJson(this.usageFile, { day: '', requests: 0 });
    for (const entry of features.service.events) if (['queued', 'working'].includes(entry.summary?.status)) entry.summary = { status: 'error', message: 'Zusammenfassung durch Neustart unterbrochen. Bei Bedarf erneut starten.' };
  }
  state(admin) { return { modelChoices: this.features.settings.summaryModels().map(({ id, name, provider, model, enabled }) => ({ id, name, provider, model, enabled, local: isLocalProvider(provider) })), ...(admin ? { ollamaStatus: this.ollamaStatus, providerCatalog: PROVIDERS, providerStatus: this.providerStatus || {}, modelProfiles: this.features.settings.summaryModels(), cloudUsage: { ...this.dailyUsage(), limit: this.features.settings.value.summaries.openaiDailyLimit } } : {}) }; }
  dailyUsage() { return this.usage.day === new Date().toISOString().slice(0, 10) ? this.usage : { day: new Date().toISOString().slice(0, 10), requests: 0 }; }
  reserveCloud() {
    const usage = this.dailyUsage();
    if (usage.requests >= this.features.settings.value.summaries.openaiDailyLimit) throw new Error('Tageslimit für Cloud-Auswertungen erreicht.');
    this.usage = { ...usage, requests: usage.requests + 1 }; writeJson(this.usageFile, this.usage);
  }
  async checkOllama(input = {}) {
    const saved = this.features.settings.value.summaries.ollama;
    const config = { ...saved, ...(typeof input.baseUrl === 'string' ? { baseUrl: input.baseUrl } : {}), ...(typeof input.model === 'string' ? { model: input.model } : {}) };
    try {
      const models = await this.providers.models(config.baseUrl);
      const selected = config.model ? await this.providers.inspect(config.baseUrl, config.model) : null;
      this.ollamaStatus = { checkedAt: new Date().toISOString(), models, selectedModel: config.model, selectedVision: selected?.vision || false };
    } catch (error) { this.ollamaStatus = { checkedAt: new Date().toISOString(), models: [], error: error.message }; throw error; }
    return this.ollamaStatus;
  }
  async checkProvider(input = {}) {
    const info = providerInfo(input.provider);
    if (!info || info.id === 'ollama') throw new Error('KI-Anbieter für diese Prüfung ungültig.');
    const saved = this.features.settings.value.summaries[info.id];
    const config = { ...saved, ...(typeof input.baseUrl === 'string' ? { baseUrl: input.baseUrl } : {}) };
    this.providerStatus ||= {};
    try { this.providerStatus[info.id] = await this.providers.check(info.id, config); }
    catch(error) { this.providerStatus[info.id] = { error: error.message, models: [] }; throw error; }
    return this.providerStatus[info.id];
  }
  async checkModel(id) {
    const config = this.features.settings.resolveSummary(id);
    if (!config) throw new Error('KI-Modell nicht gefunden.');
    this.providerStatus ||= {};
    try {
      if (config.provider === 'ollama') { const models = await this.providers.models(config.baseUrl); await this.providers.inspect(config.baseUrl, config.model); this.providerStatus[id] = { models, selectedVision: true, checkedAt: new Date().toISOString() }; }
      else this.providerStatus[id] = await this.providers.check(config.provider, config);
    } catch(error) { this.providerStatus[id] = { error: error.message, models: [] }; throw error; }
    return this.providerStatus[id];
  }
  enqueue(id, force = false,{retryAttempt=false,notify=!force}={}) {
    if (this.features.closed) throw new Error('Server wird beendet.');
    const entry = this.features.entry(id), profile = this.features.settings.profile(entry.cameraId), selectionId = profile.summaryProvider;
    if (!profile.monitoring || selectionId === 'off') { if (force) throw new Error('Zusammenfassungen für diese Kamera zuerst freigeben.'); return; }
    const config = structuredClone(this.features.settings.resolveSummary(selectionId)), provider = config?.provider;
    if (!config?.enabled || !config.model || (providerInfo(provider)?.keyRequired && !config.apiKey)) throw new Error('Gewählten KI-Anbieter zuerst einrichten und freigeben.');
    const key = `summary:${id}`;
    if (this.features.jobs.has(`delete:${id}`)) throw new Error('Clip wird gerade gelöscht.');
    if (this.features.jobs.has(key)) { if (force) throw new Error('Zusammenfassung bereits eingeplant.'); return; }
    if (!force && entry.summary?.status === 'ready' && entry.summary.provider === provider && entry.summary.model === config.model && (entry.summary.configurationId || entry.summary.provider) === selectionId) return;
    if (this.count >= 10) throw new Error('Warteschlange für Zusammenfassungen voll. Bitte warten.');
    this.count++; this.features.jobs.add(key); entry.summary = { status: 'queued', provider, model: config.model }; this.features.save();
    const task = this.tail.then(async () => {
      try {
        const latest = this.features.settings.resolveSummary(selectionId);
        const currentProfile = this.features.settings.profile(entry.cameraId);
        if (this.features.closed || !currentProfile.monitoring || currentProfile.summaryProvider !== selectionId || !latest?.enabled || latest.provider !== config.provider || latest.model !== config.model || latest.apiKey !== config.apiKey || latest.baseUrl !== config.baseUrl) { entry.summary = { status: 'skipped', provider, message: 'Anbieter oder Kamera-Einstellungen geändert; Auswertung übersprungen.' }; return; }
        entry.summary = { status: 'working', provider, model: config.model }; this.features.save();
        if(entry.needsMediaMetadata||!entry.video?.framesPerSecond){entry.video=await verifyVideo(this.features.path(entry));delete entry.needsMediaMetadata;}
        const frames = [];
        for (const seconds of summaryPositions(entry, 6)) {
          frames.push({ seconds, bytes: await extractJpeg(this.features.path(entry), { frameIndex: summaryFrameIndex(entry,seconds), atSeconds: seconds, maxWidth: 640, privacyZones: profile.privacyZones }) });
        }
        const prompt=scenePrompt(frames,profile.sceneContext,{storyboard:provider==='ollama'});
        if (!isLocalProvider(provider)) this.reserveCloud();
        const previousNames = this.features.ai.people.map(({ name }) => ({ name }));
        const description = await this.providers.summarize(provider, config, frames, prompt);
        const identities = confirmedSummaryIdentities(entry, this.features.ai, this.features.settings.profile(entry.cameraId));
        const anonymous=anonymousSceneText(description.text,[...previousNames,...this.features.ai.people]);
        const validated=validateSceneDescription(anonymous,entry),sceneText=validated.text;
        entry.summary = { status: 'ready', ...description, sceneText, text: appendConfirmedNames(sceneText, identities), identities, identitySource: 'local-multiframe', configurationId: selectionId, frameCount: frames.length, sampleSeconds: frames.map(frame => frame.seconds), at: new Date().toISOString() };
        entry.summary.layout=provider==='ollama'?'storyboard-v1':'frames-v2';entry.summary.validation=validated.fallback?{fallback:true,reason:validated.reason}:{fallback:false,cleanedFraming:validated.cleanedFraming,removedSpeculation:validated.removedSpeculation,...(validated.trajectory?{trajectory:true}:{})};
        if(force&&!notify)entry.summary.manual=true;
        if(notify){this.features.service.mobilePush?.notify(entry, 'summary');
          try { this.features.discord.enqueue(entry, 'summary'); } catch { /* Preserve the summary even if Discord is unavailable. */ }
        }
      } catch (error) { entry.summary = { status: 'error', provider, model: config.model, message: /^(KI-|Ollama|OpenAI|Gewählten|Das gewählte|Ein lokales|Tageslimit)/.test(error.message) ? error.message : 'Zusammenfassung fehlgeschlagen. Lokalen Clip und Anbieter-Einstellungen prüfen.' };if(!retryAttempt&&/erreichbar|Zeitüberschreitung|rechtzeitig/.test(error.message))this.features.operations.retry.enqueue('summary',id,{notify,configurationId:selectionId}); }
      finally { this.features.jobs.delete(key); this.count--; this.features.save(); }
    });
    this.tail = task.catch(() => {}); return this.features.track(task);
  }
}
