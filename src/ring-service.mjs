import { useLogger } from 'ring-client-api/util';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { randomUUID } from 'node:crypto';
import { stat, statfs, unlink, rename } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson } from './storage.mjs';
import { verifyVideo } from './media.mjs';
import {VIDEO_REORDER_WAIT_MS,VideoTransport,videoInputOptions} from './video-transport.mjs';
import {finalizeVideo,inspectVideoQuality,smoothVideoStart} from './video-quality.mjs';
import { RingAccounts } from './ring-accounts.mjs';
import { NetworkCameras } from './network-cameras.mjs';
import {MediaHub} from './media-hub.mjs';
import {attachVisit} from './visits.mjs';
import {observeRingTransport} from './ring-health.mjs';
export { verifyVideo } from './media.mjs';

// Ring errors can contain OAuth responses. Never forward them to the UI or logs.
let activeRingService;
useLogger({ logInfo() {}, logError(message) { activeRingService?.observeSdkTransport(message); } });

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function bounded(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  })]).finally(() => clearTimeout(timer));
}

export class RingService {
  constructor(storage, ringDrivers) {
    this.storage = storage;
    this.events = readJson(storage.events, []).map(event => event.status === 'recording' ? { ...event, status: 'error', message: 'Aufnahme durch Neustart unterbrochen.' } : event);
    this.cameras = [];
    this.phase = 'disconnected';
    this.message = 'Melde dich an, um deine Türklingel zu verbinden.';
    this.autoCameraId = null;
    this.lastAutomatic = new Map();
    this.recordings = new Map();this.captureTasks=new Set();this.mediaHub=new MediaHub();
    this.closed = false;
    this.seenNotifications = new Set();
    this.pushStatus = 'not-connected';
    this.pushTransport={status:'unconfirmed'};
    this.ringAccounts = new RingAccounts(this, ringDrivers);
    this.networkCameras = new NetworkCameras(this);
    this.diagnostics = readJson(join(storage.root, 'diagnostics.json'), null);
  }

  event(type, camera, message, extra = {}) {
    const entry = { id: randomUUID(), at: new Date().toISOString(), type, camera: camera?.name ?? null, message, ...extra };
    this.events.unshift(entry);
    // Keep clip records so older files remain accessible; transient events are bounded.
    let transient = 0;
    this.events = this.events.filter(item => item.clip || item.status === 'recording' || transient++ < 200);
    this.persistEvents();
    if (['motion', 'ding'].includes(type)) {
      try { this.cameraAccess?.record(entry); } catch { /* The event is already stored. A status update must not interrupt recording. */ }
    }
    return entry;
  }

  persistEvents() { this.archiveRevision=(this.archiveRevision||0)+1;writeJson(this.storage.events, this.events); }
  get recording(){return this.recordings.values().next().value||null;}
  set recording(job){if(job)this.recordings.set(String(job.cameraId||'_legacy'),job);else this.recordings.clear();}

  state() {
    return {
      phase: this.cameras.some(camera => camera.source === 'network' && !camera.isOffline) ? 'connected' : this.phase,
      message: this.message, autoCameraId: this.autoCameraId,
      recording: this.recording ? { cameraId: this.recording.cameraId, startedAt: this.recording.startedAt } : null,
      recordings:[...this.recordings.values()].map(job=>({cameraId:job.cameraId,startedAt:job.startedAt,until:job.deadlineMs?new Date(job.deadlineMs).toISOString():null,clipId:job.entry?.id,closing:Boolean(job.closing)})),media:this.mediaHub.state(),
      cameras: this.cameras.map(camera => ({ id: String(camera.id), name: camera.name, model: camera.model,
        source: camera.source || 'ring', battery: camera.batteryLevel, offline: camera.isOffline, features: this.features?.settings.profile?.(String(camera.id)) })),
      events: this.events.slice(0, 100).map(({ directory, ...event }) => event),
      clipCount: this.events.filter(event => event.clip && event.status === 'ready').length,
      archiveRevision:this.archiveRevision||0,
      ffmpeg: Boolean(ffmpegPath),
      hasSavedSession: Boolean(readJson(this.storage.session, null)?.refreshToken),
      ringConnections: this.ringAccounts.state(),
      pushStatus: this.pushStatus,
      pushTransport:this.pushTransport,
      diagnostics: this.diagnostics,
    };
  }

  login(email, password, id) { return this.ringAccounts.login(id, email, password); }
  verifyCode(code, id) { return this.ringAccounts.verify(id, code); }
  resume(id) { return this.ringAccounts.resume(id); }
  logout(id) { return this.ringAccounts.logout(id); }

  ringConnectionBusy(connection) {
    return connection.cameras.some(camera => this.cameras.includes(camera)
      && (this.recordings.has(String(camera.id)) || this.live?.job?.cameraId === String(camera.id)));
  }

  syncRingConnections() {
    const connections = [...this.ringAccounts.connections.values()];
    const connected = connections.filter(item => item.phase === 'connected');
    const cameras = new Map(this.networkCameras.cameras);
    for (const item of connected) for (const camera of item.cameras) {
      const id = String(camera.id);
      if (!cameras.has(id) || (cameras.get(id).isOffline && !camera.isOffline)) cameras.set(id, camera);
    }
    for (const camera of this.cameras) if (cameras.get(String(camera.id)) !== camera) {
      const id = String(camera.id);
      const job = this.recordings.get(id);
      if (job) { job.cancelled = true; job.session?.stop(); }
      if (this.live?.job?.cameraId === id) this.live.stop().catch(() => {});
      this.mediaHub.closeCamera(id);
    }
    this.cameras = [...cameras.values()];
    this.features?.settings.registerCameras(this.cameras.map(camera => String(camera.id)));
    this.cameraAccess?.observe(this.cameras, [], connected.flatMap(item => item.locations));
    const primary = this.ringAccounts.get();
    let migrated = false;
    for (const entry of this.events) if (entry.clip && entry.status === 'ready' && !entry.cameraId && entry.camera) {
      const matches = primary.cameras.filter(camera => camera.name === entry.camera);
      if (matches.length === 1) {
        entry.cameraId = String(matches[0].id);
        entry.needsMediaMetadata = !entry.video?.width || !entry.video?.durationSeconds;
        migrated = true;
      }
    }
    if (migrated) this.persistEvents();
    const transitional = connections.find(item => ['connecting', 'authenticating', 'two-factor'].includes(item.phase));
    this.phase = connected.length ? 'connected' : transitional?.phase || 'disconnected';
    const ringCount = cameras.size - this.networkCameras.cameras.size;
    this.message = connected.length ? `${ringCount} Kamera(s) über ${connected.length} Ring-Konto/Konten verbunden.` : transitional?.message || primary.message;
    this.pushStatus = connected.find(item => item.pushStatus === 'registration-failed')?.pushStatus || connected.find(item => item.pushStatus === 'receiving')?.pushStatus || connected[0]?.pushStatus || 'not-connected';
    if (connections.some(item => item.api)) activeRingService = this;
    else if (activeRingService === this) activeRingService = null;
  }

  observeSdkTransport(message) {
    if (!observeRingTransport(this, message)) return;
    const active = [...this.ringAccounts.connections.values()].filter(item => item.api);
    if (active.length === 1) active[0].transportError = true;
  }

  onRingNotification(camera, type, context) {
    const id = String(camera.id);
    const active = this.cameras.find(item => String(item.id) === id);
    if (!active) return;
    const identifier = context.eventId || context.ringDetectedAt;
    const key = identifier ? `${id}:${type}:${identifier}` : null;
    if (key) {
      if (this.seenNotifications.has(key)) return;
      this.seenNotifications.add(key);
      if (this.seenNotifications.size > 400) this.seenNotifications.delete(this.seenNotifications.values().next().value);
    }
    this.onCameraEvent(active, type, context);
  }

  onCameraEvent(camera, type, context = {}) {
    if (this.closed) return;
    const id = String(camera.id);
    const profile = this.features?.settings.profile(id);
    if (profile && !profile.monitoring) return;
    this.lastEventAt=new Date().toISOString();
    if (camera.source !== 'network') this.pushTransport={status:'receiving',at:this.lastEventAt};
    const active=this.recordings.get(id);
    const visitId=active?.entry?.visitId||attachVisit(this.events,id);
    const source = this.event(type, camera, type === 'ding' ? 'Es hat geklingelt.' : 'Bewegung gemeldet (noch keine KI-Auswertung).', { cameraId: String(camera.id), ...context,visitId });
    if (type === 'ding') { try { this.features?.discord.enqueue(source, 'ding'); } catch { /* Notification failures must not delay automatic recording. */ } }
    if (type === 'ding') this.mobilePush?.notify(source, 'ding');
    const shouldRecord = profile ? (type === 'ding' ? profile.recordDing : profile.recordMotion) : this.autoCameraId === id;
    const decision=(status,reason,message,extra={})=>{source.recordingDecision={status,reason,message,...extra};this.persistEvents();};
    if(!shouldRecord){decision('skipped','trigger-disabled',`Automatische Aufnahme bei ${type==='ding'?'Klingeln':'Bewegung'} war für diese Kamera ausgeschaltet.`);return;}
    if(active){
      if(!active.entry||active.closing){decision('skipped','recording-finishing','Die vorherige Aufnahme wird abgeschlossen. Dieses spätere Ereignis ist darin nicht enthalten.');return;}
      active.entry.sourceEventIds??=[];active.entry.sourceEventIds.push(source.id);
      if(!active.entry.triggers.includes(type))active.entry.triggers.push(type);
      if(type==='ding')active.entry.trigger='ding';
      const extended=active.extend?.()||false;
      decision('requested','joined-active-recording',extended?'Zur laufenden Aufnahme hinzugefügt; Clip wird verlängert.':'Zur laufenden Aufnahme dieses Besuchs hinzugefügt.',{clipId:active.entry.id});return;
    }
    const cooldown = (profile?.recordingCooldownSeconds ?? 60) * 1000;
    const remaining = cooldown - (Date.now() - (this.lastAutomatic.get(id) ?? 0));
    if (remaining > 0){decision('skipped','cooldown',`Aufnahmepause: Noch ${Math.ceil(remaining / 1000)} Sekunden bis zur nächsten automatischen Aufnahme. Eingestellter Mindestabstand: ${cooldown / 1000} Sekunden.`,{remainingSeconds:Math.ceil(remaining/1000)});return;}
    const requestedAt = Date.now();
    this.lastAutomatic.set(id, requestedAt);
    decision('requested','capture-requested','Eine Aufnahme wurde angefordert.');
    this.capture(id, type, { sourceEventId: source.id, ...context,visitId }).then(()=>{const clip=this.events.find(entry=>entry.sourceEventId===source.id&&entry.status==='ready'&&entry.clip);if(clip)decision('recorded','saved','Ein Clip wurde gespeichert.',{clipId:clip.id});}).catch(error=>{if(this.lastAutomatic.get(id)===requestedAt)this.lastAutomatic.delete(id);decision('failed','capture-failed',error.message||'Die Aufnahmeanforderung ist fehlgeschlagen.');});
  }

  setAutomatic(cameraId, enabled = true) {
    if (cameraId !== null && !this.cameras.some(camera => String(camera.id) === cameraId)) throw new Error('Kamera nicht gefunden.');
    this.autoCameraId = cameraId;
    if (this.features) {
      if (cameraId === null) for (const id of [...this.features.settings.value.automaticCameras]) this.features.settings.automatic(id, false);
      else if (this.networkCameras.cameras.has(cameraId)) {
        if (enabled && !this.features.settings.profile(cameraId).monitoring) throw Error('Überwachung zuerst einschalten.');
        this.features.settings.updateProfile(cameraId, { recordMotion: enabled, recordDing: false });
      } else this.features.settings.automatic(cameraId, enabled);
      this.networkCameras.reconcile();
    }
    const profile = cameraId ? this.features?.settings.profile(cameraId) : null;
    this.event('system', null, cameraId && enabled ? `Automatische Aufnahmen für diese Kamera eingeschaltet: ${profile?.recordingSeconds ?? 10} Sekunden Clipdauer, ${profile?.recordingCooldownSeconds ?? 60} Sekunden Mindestabstand zwischen Aufnahmestarts.` : 'Automatische Aufnahmen ausgeschaltet.');
  }

  capture(cameraId,trigger='manual',context={}){
    const task=this.captureCamera(cameraId,trigger,context);this.captureTasks.add(task);
    task.finally(()=>this.captureTasks.delete(task)).catch(()=>{});return task;
  }
  async captureCamera(cameraId, trigger = 'manual', context = {}) {
    if(this.closed)throw new Error('Server wird beendet.');
    if (this.recordings.has(cameraId)) throw new Error('Für diese Kamera läuft bereits eine Aufnahme.');
    const camera = this.cameras.find(item => String(item.id) === cameraId);
    if (!camera) throw new Error('Kamera nicht gefunden.');
    const network = camera.source === 'network';
    if (!network && this.phase !== 'connected') throw new Error('Bitte zuerst mit Ring verbinden.');
    if (camera.isOffline) throw new Error('Die Kamera ist offline.');
    if (this.features?.settings.profile && !this.features.settings.profile(cameraId).monitoring) throw new Error('Diese Kamera ist in Türwache pausiert. Überwachung zuerst einschalten.');
    if (!ffmpegPath) throw new Error('FFmpeg fehlt. Bitte Installation prüfen.');
    const selectedSeconds = this.features?.settings.profile?.(cameraId).recordingSeconds;
    const recordingSeconds = [10, 20, 30, 45, 60].includes(selectedSeconds) ? selectedSeconds : 10;
    const extendEnabled=this.features?.settings.profile?.(cameraId).extendRecording===true;
    const maximumSeconds=extendEnabled?Math.max(recordingSeconds,60):recordingSeconds;
    const entry = this.event('clip', camera, 'Livevideo wird gestartet …', { status: 'recording', trigger, cameraId, ...context,visitId:context.visitId||randomUUID(),triggers:[trigger],sourceEventIds:context.sourceEventId?[context.sourceEventId]:[], requestedSeconds: recordingSeconds });
    const filename = `${entry.id}.mp4`;
    const directory = this.features?.settings.value.clipsDirectory || this.storage.clips;
    entry.directory = directory;
    const path = join(directory, filename);
    const partialPath = join(directory, `${entry.id}.part.mp4`);
    const started = Date.now();
    const job = { cameraId, startedAt: new Date().toISOString(), session: null, cancelled: false,entry,closing:false };
    this.recordings.set(cameraId,job);
    let videoSubscription, endedSubscription, timer, fileWatcher,durationTimer, initialKeyFrame;
    const scheduleEnd = () => {
      clearTimeout(durationTimer);
      // Let in-flight retransmissions reach FFmpeg before the hard stop.
      const grace = job.session?.connection?.rawVideoRtp ? VIDEO_REORDER_WAIT_MS : 0;
      if (network) return;
      durationTimer = setTimeout(() => {
        job.closing = true;
        job.session?.stop();
      }, Math.max(1, job.deadlineMs + grace - Date.now()));
    };
    job.extend=()=>{if(!extendEnabled||!job.firstVideoAtMs||job.closing)return false;const next=Math.min(job.firstVideoAtMs+maximumSeconds*1000,Date.now()+recordingSeconds*1000);if(next<=job.deadlineMs)return false;job.deadlineMs=next;entry.requestedSeconds=Math.ceil((next-job.firstVideoAtMs)/1000);entry.extended=true;scheduleEnd();return true;};
    const transport=new VideoTransport();
    const finalizedPath=join(directory, `${entry.id}.finalizing.mp4`);
    const timedPath=join(directory, `${entry.id}.timing.mp4`);
    try {
      const volume = await statfs(directory);
      if (volume.bavail * volume.bsize < 512 * 1024 * 1024) throw new Error('Weniger als 512 MB Speicher frei. Bitte zuerst Clips löschen.');
      let session, buffered;
      if (network) {
        job.firstVideoAtMs = started;
        job.deadlineMs = started + recordingSeconds * 1000;
        entry.message = 'Netzwerkvideo wird aus dem Voraufnahmepuffer gesichert …';
        buffered = await camera.stream.record(partialPath, {
          start: started, pre: camera.preRoll, deadline: () => job.deadlineMs, cancelled: () => job.cancelled,
          closing: () => { job.closing = true; },
        });
      } else {
        fileWatcher = setInterval(() => {
          if (entry.firstFileBytesMs !== undefined) return;
          try {
            if (statSync(partialPath).size > 0) entry.firstFileBytesMs = Date.now() - started;
          } catch { /* File is not created until the media pipeline starts. */ }
        }, 50);
        // If Ring answers after our timeout, close that late session immediately.
        const opening = this.mediaHub.acquire(camera,'recording').then(session => {
          if (job.cancelled) { session.stop(); throw new Error('Aufnahme abgebrochen.'); }
          job.session = session;
          return session;
        });
        session = await bounded(opening, 25000, 'Kein Livevideo innerhalb von 25 Sekunden.');
        entry.sessionCreatedMs = Date.now() - started;
        entry.videoRecovery=session.connection?.videoRecovery;
        if (job.cancelled) throw new Error('Aufnahme abgebrochen.');
        const incomingVideo = session.connection?.rawVideoRtp ?? session.onVideoRtp;
        videoSubscription = incomingVideo.subscribe(packet => {
          transport.observe(packet);
          if (entry.firstFrameMs === undefined) {
            job.firstVideoAtMs=Date.now();job.deadlineMs=job.firstVideoAtMs+recordingSeconds*1000;scheduleEnd();
            entry.firstFrameMs = Date.now() - started;
            entry.firstVideoPacketMs = entry.firstFrameMs;
            if (Number.isFinite(context.receivedAtMs)) entry.detectionToPacketMs = context.pushDelayMs === undefined ? undefined : context.pushDelayMs + Date.now() - context.receivedAtMs;
            entry.message = 'Videodaten empfangen. Aufnahme läuft …';
            this.persistEvents();
          }
        });
        const ended = new Promise(resolve => { endedSubscription = session.onCallEnded.subscribe(()=>{job.closing=true;resolve();}); });
        timer = setTimeout(() => session.stop(), (maximumSeconds + 15) * 1000);
        await bounded(session.startTranscoding({ input:videoInputOptions(), audio: ['-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1'], video: ['-vcodec', 'copy'], output: ['-t', String(maximumSeconds), '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '250000', '-f', 'mp4', '-y', partialPath] }), 15000, 'Videostart hat zu lange gedauert.');
        if (session.connection?.rawVideoRtp) {
          // The SDK requests an IDR while FFmpeg is still opening its input sockets.
          // Ask once again if RTP is arriving but FFmpeg has produced no bytes yet.
          initialKeyFrame = setTimeout(() => {
            if (!job.closing && !job.cancelled && entry.firstFrameMs !== undefined && entry.firstFileBytesMs === undefined) {
              session.requestKeyFrame?.();
            }
          }, 550);
          initialKeyFrame.unref();
        }
        await ended;
        clearTimeout(timer);
        if (job.cancelled) throw new Error('Aufnahme abgebrochen.');
        if (entry.firstFrameMs === undefined) throw new Error('Keine Videodaten von der Kamera empfangen.');
        }
        // FFmpeg closes asynchronously after onCallEnded; wait for a finalized MP4.
        let verified = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          if (job.cancelled) throw new Error('Aufnahme abgebrochen.');
          try {
            entry.video = await verifyVideo(partialPath);
            verified = true;
            break;
          } catch { await wait(500); }
        }
        if (job.cancelled) throw new Error('Aufnahme abgebrochen.');
        if (!verified) throw new Error('Der Clip konnte nicht als lesbares Video gespeichert werden.');
        if (buffered) Object.assign(entry.video, buffered);
        else entry.video.transport = transport.state();
        if (session?.connection?.recoveryMetrics) entry.video.transport.recovery = session.connection.recoveryMetrics();
        // Fragmented MP4 keeps partial recordings recoverable. Publish a conventional
        // fast-start MP4 afterwards for browser/Discord seeking, without re-encoding.
        try { await finalizeVideo(partialPath,finalizedPath);await verifyVideo(finalizedPath);await rename(finalizedPath,path);await unlink(partialPath).catch(()=>{});entry.video.fastStart=true; }
        catch {await unlink(finalizedPath).catch(()=>{});await rename(partialPath,path);entry.video.fastStart=false;}
        try{entry.video.quality=await inspectVideoQuality(path);}catch{entry.video.quality={checked:false,impaired:null};}
        if (!network && entry.video.quality.startupTiming) {
          try {
            const quality = await smoothVideoStart(path, timedPath, entry.video.quality);
            const media = await verifyVideo(timedPath);
            if (!job.cancelled && media.hasAudio === entry.video.hasAudio) {
              await rename(timedPath, path);
              entry.video = {...entry.video, ...media, quality, fastStart: true};
            }
          } catch { /* Keep the verified clip if timestamp repair fails. */ }
          finally { await unlink(timedPath).catch(() => {}); }
        }
        const file = await stat(path);
        entry.status = 'ready';
        entry.clip = filename;
        entry.bytes = file.size;
        for(const id of entry.sourceEventIds){const source=this.events.find(item=>item.id===id);if(source)source.recordingDecision={status:'recorded',reason:'saved',message:'Ein Clip wurde gespeichert.',clipId:entry.id};}
        const audioNote = entry.video.hasAudio ? 'Mit Ton.' : 'Ohne Ton: Kamera hat keine Tonspur geliefert.';
        entry.message = entry.video.durationSeconds !== undefined && entry.video.durationSeconds < recordingSeconds - 1 ? `Verkürzter Clip lokal gespeichert (${Math.round(entry.video.durationSeconds)} statt ${recordingSeconds} Sekunden). ${audioNote}` : `Clip lokal gespeichert. ${audioNote}`;
        if(entry.extended)entry.message+=' Aufnahme bei weiterer Aktivität verlängert.';
        if (buffered?.interrupted) entry.message += ' Der Netzwerkstream wurde während der Aufnahme unterbrochen.';
        if (buffered?.preRollSeconds) entry.message += ` Mit ${buffered.preRollSeconds.toLocaleString('de-DE')} Sekunden Voraufnahme.`;
        if(entry.video.quality.impaired)entry.message+=' Bildqualität beeinträchtigt: beschädigte Bilder oder Zeitlücken im empfangenen Video.';
        this.persistEvents();
        // A post-processing failure must never turn a successfully saved clip into an error.
        try { this.features?.ready(entry); } catch { /* Clip remains playable; settings can be corrected. */ }
      } catch (error) {
        entry.status = 'error';
        // Only messages produced here, never raw responses from Ring.
        const ownMessages = ['Kein Livevideo innerhalb von 25 Sekunden.', 'Videostart hat zu lange gedauert.', 'Keine Videodaten von der Kamera empfangen.', 'Der Clip konnte nicht als lesbares Video gespeichert werden.', 'Aufnahme abgebrochen.', 'Weniger als 512 MB Speicher frei. Bitte zuerst Clips löschen.'];
        entry.message = job.cancelled ? 'Aufnahme abgebrochen.' : ownMessages.includes(error.message) ? error.message :
          network ? 'Netzwerkaufnahme fehlgeschlagen. Kameraverbindung und Voraufnahmepuffer prüfen.' :
          'Aufnahme fehlgeschlagen. Livevideo in der Ring-App und Internetverbindung prüfen.';
        for(const id of entry.sourceEventIds){const source=this.events.find(item=>item.id===id);if(source)source.recordingDecision={status:'failed',reason:'capture-failed',message:entry.message};}
        this.persistEvents();
        await unlink(partialPath).catch(() => {});
        throw new Error(entry.message);
      } finally {
        job.cancelled = true;
        clearTimeout(timer);
        clearInterval(fileWatcher);
        clearTimeout(durationTimer);
        clearTimeout(initialKeyFrame);
        videoSubscription?.unsubscribe();
        endedSubscription?.unsubscribe();
        job.session?.stop();
        if (this.recordings.get(cameraId) === job) this.recordings.delete(cameraId);
      }
    }
  
    async diagnose(cameraId) {
      const camera = this.cameras.find(item => String(item.id) === cameraId);
      if (camera?.source === 'network') {
        this.diagnostics = { checkedAt: new Date().toISOString(), cameraId, name: camera.name, model: camera.model,
          online: !camera.isOffline, healthRead: true, source: 'network', preRoll: camera.preRoll };
        writeJson(join(this.storage.root, 'diagnostics.json'), this.diagnostics);
        return this.diagnostics;
      }
      if (this.phase !== 'connected' || !camera) throw new Error('Bitte zuerst eine verbundene Kamera auswählen.');
      const health = await bounded(camera.getHealth(), 15000, 'Gerätestatus konnte nicht rechtzeitig gelesen werden.').catch(() => null);
      const report = {
        checkedAt: new Date().toISOString(), cameraId, name: camera.name, model: camera.model,
        online: !camera.isOffline, battery: camera.batteryLevel,
        liveViewDisabled: camera.data?.settings?.live_view_disabled === true,
        pushStatus: this.pushStatus,
        healthRead: Boolean(health),
        wifiSignal: health?.latest_signal_strength ?? camera.data?.health?.rssi ?? null,
        firmware: typeof health?.firmware === 'string' ? health.firmware : camera.data?.firmware_version ?? null,
        subscriptionVerified: false,
        recentClips: this.events.filter(item => item.cameraId === cameraId && item.type === 'clip').slice(0, 5).map(({ id, status, trigger, firstVideoPacketMs, firstFileBytesMs, video }) => ({ id, status, trigger, firstVideoPacketMs, firstFileBytesMs, video })),
      };
      this.diagnostics = report;
      writeJson(join(this.storage.root, 'diagnostics.json'), report);
      return report;
    }
  
    async deleteClip(id) {
      const entry = this.events.find(item => item.id === id && item.clip);
      if (!entry) throw new Error('Clip nicht gefunden.');
      await this.features?.beforeDelete(entry);
      try {
        await unlink(join(entry.directory || this.storage.clips, entry.clip)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        this.events = this.events.filter(item => item !== entry);
        this.persistEvents();
      } finally { this.features?.jobs.delete(`delete:${entry.id}`); }
    }
  
    close() {
      this.closed = true;
      for (const job of this.recordings.values()) { job.cancelled = true; job.session?.stop(); }
      this.ringAccounts.close();
      this.networkCameras.close();
      this.mediaHub.closeAll();
      this.live?.stop().catch(() => {});
      if (activeRingService === this) activeRingService = null;
    }
  }
