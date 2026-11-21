import { providerLabel, isLocalProvider } from './provider-catalog.mjs';
import { readFile, stat } from 'node:fs/promises';
import { DiscordClient, DISCORD_FILE_LIMIT } from './discord.mjs';
import { extractJpeg } from './media.mjs';
import { prepareClipCopy } from './privacy-zones.mjs';

const labels = { ding: 'Klingelmeldung', clip: 'Klingel-Clip', motionClip: 'Bewegungsclip', person: 'Personenmeldung', summary: 'KI-Zusammenfassung' };
const featureFor = { ding: 'discordDing', clip: 'discordDingClip', motionClip: 'discordMotionClip', person: 'discordPerson', summary: 'discordSummary' };
export class DiscordNotifications {
  constructor(features, client = new DiscordClient()) {
    this.features = features; this.client = client; this.tail = Promise.resolve(); this.last = new Map(); this.count = 0;
    for (const entry of features.service.events) for (const value of Object.values(entry.discord || {})) if (['queued', 'sending'].includes(value.status)) Object.assign(value, { status: 'error', message: 'Discord-Versand durch Neustart unterbrochen. Zustellung unklar.' });
  }
  unavailableReason(entry, kind) {
    const profile = this.features.settings.profile(entry.cameraId), config = this.features.settings.value.discord;
    if (this.features.closed) return 'Server wird beendet.';
    if (!config.enabled) return 'Discord-Versand war global ausgeschaltet.';
    if (!config.webhookUrl) return 'Kein Discord-Webhook eingerichtet.';
    if (!profile.monitoring) return 'Die Kamera war pausiert.';
    if (!profile[featureFor[kind]]) return `${labels[kind]} war im Kamera-Profil ausgeschaltet.`;
    if (kind === 'summary' && profile.summaryProvider === 'off') return 'KI-Zusammenfassungen waren für diese Kamera ausgeschaltet.';
    return null;
  }
  allowed(entry, kind) { return !this.unavailableReason(entry, kind); }
  enqueue(entry, kind, retry = false) {
    if (!Object.hasOwn(labels, kind)) throw new Error('Discord-Nachrichtentyp ungültig.');
    const unavailable = this.unavailableReason(entry, kind);
    if (unavailable) { if (retry) throw new Error('Discord und die passende Kamera-Funktion zuerst freigeben.'); if (!entry.discord?.[kind]) { entry.discord ??= {}; entry.discord[kind] = { status: 'disabled', message: unavailable }; this.features.save(); } return; }
    if (kind === 'ding' && entry.type !== 'ding') throw new Error('Kein Klingelereignis.');
    if (kind === 'clip' && (entry.status !== 'ready' || entry.trigger !== 'ding' || !entry.clip)) throw new Error('Kein fertiger Klingel-Clip.');
    if (kind === 'motionClip' && (entry.status !== 'ready' || entry.trigger !== 'motion' || !entry.clip)) throw new Error('Kein fertiger Bewegungsclip.');
    if (kind === 'person' && (entry.status !== 'ready' || entry.ai?.status !== 'ready' || !entry.ai.personDetected)) throw new Error('Keine bestätigte Personenerkennung in diesem Clip.');
    if (kind === 'summary' && (entry.status !== 'ready' || entry.summary?.status !== 'ready')) throw new Error('Keine fertige KI-Zusammenfassung in diesem Clip.');
    const previous = entry.discord?.[kind], key = `discord:${entry.id}:${kind}`;
    if (previous && (!retry || !['error', 'skipped', 'disabled'].includes(previous.status))) return;
    if (this.features.jobs.has(`delete:${entry.id}`)) throw new Error('Clip wird gerade gelöscht.');
    if (this.count >= 20) { entry.discord ??= {}; entry.discord[kind] = { status: 'error', message: 'Discord-Warteschlange voll. Später erneut senden.' }; this.features.save(); return; }
    const profile = this.features.settings.profile(entry.cameraId), config = structuredClone(this.features.settings.value.discord);
    const limitKey = `${entry.cameraId}:${kind}`;
    const cooldown = kind === 'ding' ? 10_000 : kind === 'person' ? config.personCooldownSeconds * 1000 : 0;
    entry.discord ??= {};
    if (!retry && Date.now() - (this.last.get(limitKey) || 0) < cooldown) {
      entry.discord[kind] = { status: 'skipped', message: 'Discord-Pause zwischen zwei Meldungen dieser Kamera aktiv.' }; this.features.save(); return;
    }
    this.last.set(limitKey, Date.now());
    this.features.jobs.add(key); this.count++; entry.discord[kind] = { status: 'queued' }; this.features.save();
    const task = this.tail.then(async () => {
      try {
        if (!this.allowed(entry, kind) || this.features.settings.value.discord.webhookUrl !== config.webhookUrl) { entry.discord[kind] = { status: 'skipped', message: 'Discord-Einstellungen geändert; Versand übersprungen.' }; return; }
        entry.discord[kind] = { status: 'sending' }; this.features.save();
        const time = new Date(entry.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
        const camera = String(entry.camera || 'Kamera').slice(0, 100);
        let text = `${kind === 'ding' ? '🔔 Es hat geklingelt' : kind === 'clip' ? '🎞️ Aufnahme zur Türklingel' : kind === 'motionClip' ? '🎞️ Aufnahme bei Bewegung' : kind === 'summary' ? '✳️ KI-Zusammenfassung' : '👤 Person erkannt'} · ${camera}\n${time}`;
        const privacyZones = profile.privacyZones || [];
        if (kind === 'summary') text += privacyZones.length ? '\nEine Privatzone ist aktiv. Die Beschreibung ist in Türwache verfügbar.' : `\n${entry.summary.text.slice(0, 1400)}\nKI-Auswertung: ${providerLabel(entry.summary.provider) + (isLocalProvider(entry.summary.provider) ? ' (lokal)' : '')}`;
        if (kind === 'clip') {
          const related = entry.sourceEventIds?.length ? entry.sourceEventIds : [entry.sourceEventId];
          const source = related.map(id => this.features.service.events.find(item => item.id === id))
            .find(item => item?.type === 'ding');
          if (source) text += `\nKlingeln: ${new Date(source.at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })}`;
        }
        if (kind === 'person' && !privacyZones.length && entry.ai.names?.length) text += `\nLokale Gesichtserkennung: ${entry.ai.names.join(', ').slice(0, 500)} (KI-Zuordnung)`;
        let file, note;
        if (kind === 'clip' || kind === 'motionClip') {
          const {quality, transport} = entry.video || {};
          if (quality?.impaired) {
            const issues = [];
            if (quality.maxGapSeconds > .25) issues.push(`Größte Bildlücke ${quality.maxGapSeconds.toLocaleString('de-DE', {minimumFractionDigits: 1, maximumFractionDigits: 2})} s`);
            if (quality.decodeErrors > 0) issues.push('Decoderfehler erkannt');
            if (transport?.missingPackets > 0) issues.push(`${transport.missingPackets} fehlende Videopakete`);
            text += '\n⚠️ Aufnahme beeinträchtigt.' + (issues.length ? ' ' + issues.join(' · ') : '');
          }
          const copy = await prepareClipCopy(this.features, entry, privacyZones);
          try {
            if ((await stat(copy.path)).size <= DISCORD_FILE_LIMIT) file = { bytes: await readFile(copy.path), type: 'video/mp4', name: `tuerwache-${entry.id}.mp4` };
            else { text += '\nClip größer als 8 MiB; er bleibt lokal gespeichert.'; note = 'Clip über dem Versandlimit; nur Text gesendet.'; }
          } finally { await copy.close(); }
        }
        if ((kind === 'person' && profile.discordPersonImage) || (kind === 'summary' && profile.discordSummaryImage)) {
          const samples = entry.ai?.samples || [];
          const sample = samples.find(s => s.faces?.some(face => face.name)) || samples.find(s => s.people?.length) || samples.find(s => s.faces?.length);
          const seconds = Number.isFinite(sample?.seconds) ? sample.seconds : sample ? (entry.video?.durationSeconds || 1) * sample.fraction : entry.summary?.sampleSeconds?.[Math.floor(entry.summary.sampleSeconds.length / 2)] ?? (entry.video?.durationSeconds || 1) / 2;
          try { file = { bytes: await extractJpeg(this.features.path(entry), { frameIndex: sample?.frameIndex, atSeconds: seconds, privacyZones }), type: 'image/jpeg', name: `${kind === 'person' ? 'person' : 'szene'}-${entry.id}.jpg` }; }
          catch { text += '\nVorschaubild nicht verfügbar; der Clip bleibt lokal gespeichert.'; note = 'Vorschaubild konnte nicht erstellt werden; nur Text gesendet.'; }
        }
        const attachmentExpected = ['clip', 'motionClip'].includes(kind) || (kind === 'person' && profile.discordPersonImage) || (kind === 'summary' && profile.discordSummaryImage);
        entry.discord[kind] = { ...(await this.client.send(config.webhookUrl, text, file)), attachmentExpected, ...(note ? { note } : {}) };
      } catch (error) {
        // Only driver-owned, sanitized errors; never persist raw webhook/network errors.
        const safe = /^(Discord|Gültige Discord|Nur offizielle)/.test(error.message);
        entry.discord[kind] = { status: 'error', message: safe ? error.message : `${labels[kind]} konnte nicht versendet werden. Lokale Datei und Discord-Konfiguration prüfen.` };
      } finally { this.features.jobs.delete(key); this.count--; this.features.save(); }
    });
    this.tail = task.catch(() => {}); this.features.track(task); return task;
  }
  busyCamera(cameraId) { return this.features.service.events.some(entry => entry.cameraId === cameraId && Object.keys(labels).some(kind => this.features.jobs.has(`discord:${entry.id}:${kind}`))); }
  async test() {
    const config = this.features.settings.value.discord;
    if (!config.enabled || !config.webhookUrl) throw new Error('Discord-Verbindung zuerst speichern und freigeben.');
    if (this.count >= 20) throw new Error('Discord-Warteschlange voll. Bitte warten.');
    const task = this.tail.then(async () => {
      if (!this.features.settings.value.discord.enabled || this.features.settings.value.discord.webhookUrl !== config.webhookUrl) throw new Error('Discord-Einstellungen geändert. Test erneut starten.');
      const result = await this.client.send(config.webhookUrl, '✅ Türwache-Testnachricht. Die Discord-Verbindung funktioniert.');
      this.features.service.event('system', null, 'Discord-Testnachricht zugestellt.'); return result;
    });
    this.tail = task.catch(() => {}); return this.features.track(task);
  }
  retry(id, kind) {
    if (!Object.hasOwn(labels, kind)) throw new Error('Discord-Nachrichtentyp ungültig.');
    const entry = this.features.service.events.find(item => item.id === id);
    if (!entry) throw new Error('Ereignis nicht gefunden.');
    return this.enqueue(entry, kind, true);
  }
}
