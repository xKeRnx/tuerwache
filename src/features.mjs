import { join } from 'node:path';
import { Settings } from './settings.mjs';
import { CloudStorage } from './cloud-storage.mjs';
import { AIService } from './ai-service.mjs';
import { ManagedFaceWorker } from './managed-face-worker.mjs';
import { DiscordNotifications } from './discord-notifications.mjs';
import { Summaries } from './summaries.mjs';
import { FaceSuggestions } from './face-suggestions.mjs';
import { verifyVideo } from './media.mjs';
import {JobTracker} from './job-tracker.mjs';
import {Operations} from './operations.mjs';
import {AIQuality} from './ai-quality.mjs';

export class Features {
  constructor(service, projectRoot) {
    this.service = service; this.settings = new Settings(service.storage);
    this.managedFaceWorker = new ManagedFaceWorker(projectRoot);
    this.cloud = new CloudStorage(); this.ai = new AIService(service.storage.root, projectRoot, { faceWorker: () => this.workerConnection() });
    this.jobs = new JobTracker(); this.cloudTail = Promise.resolve(); this.pending = new Set(); this.closed = false;
    this.discord = new DiscordNotifications(this);
    this.summaries = new Summaries(this);
    this.faceSuggestions=new FaceSuggestions(this);
    service.features = this;
    this.quality=new AIQuality(this);this.operations=new Operations(this,projectRoot);
    this.ai.onGalleryChange = () => this.invalidateIdentityEvidence();
    if (service.cameras?.length) this.settings.registerCameras(service.cameras.map(camera => String(camera.id)));
    let staleIdentities = false;
    for (const entry of service.events) {
      if (['queued', 'working'].includes(entry.ai?.status)) entry.ai = { status: 'error', message: 'KI durch Neustart unterbrochen. Erneut auswerten.' };
      if (entry.ai?.names?.length && (entry.ai.identityVersion !== 2 || entry.ai.galleryRevision !== this.ai.galleryRevision())) staleIdentities = true;
      if (['queued', 'uploading'].includes(entry.cloud?.status)) entry.cloud = { status: 'error', message: 'Upload durch Neustart unterbrochen. Erneut hochladen.' };
    }
    if (staleIdentities) this.invalidateIdentityEvidence();
    service.persistEvents();
  }
  workerConnection() {
    const config = this.settings.faceWorker();
    if (!config.enabled) return config;
    return this.managedFaceWorker.connection(config).catch(() => ({ ...config, enabled: false }));
  }
  startFaceWorker() { void this.workerConnection(); }
  async checkFaceWorker(input) {
    const config = this.settings.previewFaceWorker(input);
    if (config.mode === 'local' && config.arcface) await this.managedFaceWorker.checkArcFace();
    return this.ai.checkFaceWorker(await this.managedFaceWorker.connection(config));
  }
  state(admin) { return { cameraProfiles: Object.fromEntries(Object.keys(this.settings.value.cameraProfiles).map(id => [id, this.settings.profile(id)])), ...(admin ? { settings: this.settings.public(),faceSuggestions:this.faceSuggestions.list() } : {}), ...(admin?{operations:this.operations.state(),aiQuality:this.quality.state()}:{}), summaryService: this.summaries.state(admin), ai: { ...this.ai.state(), ...(admin ? {} : { people: [] }) } }; }
  path(entry) { return join(entry.directory || this.service.storage.clips, entry.clip); }
  entry(id) { const entry = this.service.events.find(e => e.id === id && e.status === 'ready' && e.clip); if (!entry) throw new Error('Clip nicht gefunden.'); return entry; }
  save() { this.service.persistEvents(); }
  ready(entry) {
    if(this.closed)return;
    const profile = this.settings.profile(entry.cameraId);
    if (!profile.monitoring) return;
    if (entry.trigger === 'ding') this.service.mobilePush?.notify(entry, 'clip');
    if (['ding', 'motion'].includes(entry.trigger)) { try { this.discord.enqueue(entry, entry.trigger === 'ding' ? 'clip' : 'motionClip'); } catch { /* Optional notification cannot change recording success. */ } }
    let analysis = Promise.resolve();
    if (profile.personDetection || profile.faceRecognition) {
      try { analysis = this.analyze(entry.id); }
      catch (error) { entry.ai = { status: 'error', message: error.message }; this.save(); }
    }
    if (profile.summaryProvider !== 'off') this.track(analysis.catch(() => {}).then(() => {
      if (this.closed) return;
      try { this.summaries.enqueue(entry.id); }
      catch (error) { entry.summary = { status: 'error', provider: profile.summaryProvider, message: error.message }; this.save(); }
    }));
    if (profile.cloudUpload && this.settings.value.cloud.enabled) {
      try { this.upload(entry.id).catch(() => {}); }
      catch { entry.cloud = { status: 'error', message: 'Cloud-Upload konnte nicht eingeplant werden.' }; this.save(); }
    }
  }
  track(task) { this.pending.add(task); task.finally(() => this.pending.delete(task)).catch(() => {}); return task; }
  analyze(id, { notify = true,retryAttempt=false } = {}) {
    if (this.closed) throw new Error('Server wird beendet.');
    const entry = this.entry(id), key = `ai:${id}`;
    const profile = this.settings.profile(entry.cameraId);
    if (!profile.monitoring || (!profile.personDetection && !profile.faceRecognition)) throw new Error('KI für diese Kamera zuerst im Kamera-Profil einschalten.');
    if (this.jobs.has(`delete:${id}`)) throw new Error('Clip wird gerade gelöscht.');
    if (this.jobs.has(key)) throw new Error('KI-Auswertung bereits eingeplant.');
    if (!this.ai.state().modelsReady) throw new Error('KI-Modelle fehlen. Installationsanleitung auf dem Server beachten.');
    if (this.jobs.size > 50) throw new Error('Zu viele ausstehende Auswertungen. Bitte warten.');
    if (entry.summary?.identities?.length) { entry.summary.text = entry.summary.sceneText || ''; entry.summary.identities = []; entry.summary.identityStatus = 'analysis-pending'; }
    this.jobs.add(key); entry.ai = { status: 'queued' }; this.save();
    const task = (async () => {
      try {
        entry.ai = { status: 'working' }; this.save();
        if(entry.needsMediaMetadata){entry.video=await verifyVideo(this.path(entry));delete entry.needsMediaMetadata;}
        entry.ai = { ...(await this.ai.analyze(this.path(entry), this.settings.value.faceThreshold, profile)), at: new Date().toISOString() };
        if (notify && entry.ai.personDetected) { this.service.mobilePush?.notify(entry, 'person'); try { this.discord.enqueue(entry, 'person'); } catch { /* Preserve successful analysis even if notifications fail. */ } }
        else if (!entry.ai.personDetected && (!entry.discord?.person || entry.discord.person.status === 'not-triggered')) { entry.discord ??= {}; entry.discord.person = { status: 'not-triggered', message: `Keine Person in ${entry.ai.sampleCount || 0} geprüften Bildern erkannt; deshalb keine Personenmeldung und kein Personenbild.` }; }
      }
      catch (error) { entry.ai = { status: 'error', message: error.message };if(!retryAttempt&&this.ai.state().modelsReady)this.operations.retry.enqueue('ai',id,{notify}); }
      finally { this.jobs.delete(key); this.save(); }
    })(); return this.track(task);
  }
  upload(id,{retryAttempt=false}={}) {
    if (this.closed) throw new Error('Server wird beendet.');
    const entry = this.entry(id), key = `cloud:${id}`, config = structuredClone(this.settings.value.cloud);
    const profile = this.settings.profile(entry.cameraId);
    if (!profile.monitoring || !profile.cloudUpload) throw new Error('Cloud-Kopie für diese Kamera zuerst im Kamera-Profil einschalten.');
    if (this.jobs.has(`delete:${id}`)) throw new Error('Clip wird gerade gelöscht.');
    if (!config.enabled) throw new Error('Cloud-Speicher zuerst konfigurieren und einschalten.');
    if (this.jobs.has(key) || entry.cloud?.status === 'uploaded') throw new Error('Cloud-Kopie bereits vorhanden oder eingeplant.');
    if (this.jobs.size > 50) throw new Error('Zu viele ausstehende Uploads. Bitte warten.');
    this.jobs.add(key); entry.cloud = { status: 'queued' }; this.save();
    const task = this.cloudTail.then(async () => {
      const latest = this.settings.profile(entry.cameraId);
      if (!latest.monitoring || !latest.cloudUpload || !this.settings.value.cloud.enabled) {
        entry.cloud = { status: 'skipped', message: 'Upload durch geänderte Kamera-Einstellungen übersprungen.' };
        this.jobs.delete(key); this.save(); return;
      }
      try { entry.cloud = { status: 'uploading' }; this.save(); entry.cloud = await this.cloud.upload(config, entry, this.path(entry)); }
      catch { entry.cloud = { status: 'error', message: 'S3-Upload fehlgeschlagen. Endpunkt, Schlüssel und Bucket-Berechtigungen prüfen.' };if(!retryAttempt)this.operations.retry.enqueue('upload',id); }
      finally { this.jobs.delete(key); this.save(); }
    }); this.cloudTail = task.catch(() => {}); return this.track(task);
  }
  assertIdle(id) { if (['ai','cloud','summary','delete','backup','comparison','retention'].some(kind=>this.jobs.has(`${kind}:${id}`)) || ['ding', 'clip', 'motionClip', 'person', 'summary'].some(kind => this.jobs.has(`discord:${id}:${kind}`))) throw new Error('Clip wird gerade verarbeitet. Bitte warten.'); }
  updateCamera(cameraId, profile) {
    if (!this.service.cameras.some(camera => String(camera.id) === cameraId) && !this.service.cameraAccess?.value.cameras.some(camera => camera.id === cameraId)) throw new Error('Kamera nicht gefunden.');
    // Apply profiles between jobs so disabling a feature never overlaps an active inference/upload.
    if (this.discord.busyCamera(cameraId) || this.service.events.some(entry => entry.cameraId === cameraId && ['ai', 'cloud', 'summary', 'comparison'].some(kind => this.jobs.has(`${kind}:${entry.id}`)))) throw new Error('Kamera verarbeitet noch einen Clip oder eine Nachricht. Profil danach speichern.');
    const result = this.settings.updateProfile(cameraId, profile);
    this.service.networkCameras?.reconcile();
    const recording=this.service.recordings?.get(cameraId)||(this.service.recording?.cameraId===cameraId?this.service.recording:null);
    if (!result.monitoring && recording) { recording.cancelled = true; recording.session?.stop(); }
    if (!result.monitoring && this.service.live?.job?.cameraId === cameraId) this.service.live.stop().catch(() => {});
    this.service.event('system', null, 'Kamera-Profil gespeichert.', { cameraId });
    return result;
  }
  async beforeDelete(entry) {
    this.assertIdle(entry.id); this.jobs.add(`delete:${entry.id}`);
    try {
      if (entry.cloud?.status === 'uploaded') {
        const config = this.settings.value.cloud;
        if (!config.accessKeyId || !config.secretAccessKey) throw new Error('S3-Zugangsdaten zum Löschen der Cloud-Kopie fehlen.');
        try { await this.cloud.remove(config, entry.cloud); }
        catch (error) { if (error.message.startsWith('Zum Löschen')) throw error; throw new Error('Cloud-Kopie konnte nicht gelöscht werden. Lokaler Clip bleibt erhalten.'); }
        entry.cloud = { status: 'deleted' }; this.save();
      }
    } catch (error) { this.jobs.delete(`delete:${entry.id}`); throw error; }
  }
  invalidateIdentityEvidence() {
    for (const entry of this.service.events) {
      if (entry.ai?.status === 'ready') { entry.ai.names = []; entry.ai.confirmedIdentities = []; entry.ai.identityGalleryStale = true;
        for (const sample of entry.ai.samples || []) for (const face of sample.faces || []) { if (face.name || face.personId || face.identityConfirmed) face.identityStatus = 'needs-reanalysis'; face.name = null; face.personId = null; face.identityConfirmed = false; }
      }
      if (entry.summary?.identities?.length) { entry.summary.text = entry.summary.sceneText || ''; entry.summary.identities = []; entry.summary.identityStatus = 'gallery-changed'; }
    }
    this.save();
  }
  async drain() { this.closed = true;await this.operations.stop(); await Promise.allSettled([...(this.service.captureTasks||[]),...this.pending, this.ai.tail, this.service.mobilePush?.drain(), this.service.live?.stop()]); await Promise.all([this.ai.close(), this.managedFaceWorker.close()]); }
}
