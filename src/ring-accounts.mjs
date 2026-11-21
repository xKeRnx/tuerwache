import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { RingApi, PushNotificationAction } from 'ring-client-api';
import { RingRestClient } from 'ring-client-api/rest-client';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { readJson, writeJson } from './storage.mjs';
import { TotpVault } from './totp.mjs';
import { createEventRegistration, detectionInfo } from './event-registration.mjs';

export const primaryRingAccount = 'primary';
const displayName = 'Türwache';

function waitFor(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

export class RingAccounts {
  constructor(service, { createApi = options => new RingApi(options), createLogin = options => new RingRestClient(options) } = {}) {
    this.service = service;
    this.createApi = createApi;
    this.createLogin = createLogin;
    this.file = join(service.storage.root, 'ring-accounts.json');
    this.saved = readJson(this.file, []);
    const primary = this.saved.find(item => item.id === primaryRingAccount) || { id: primaryRingAccount, name: 'Standardkonto' };
    this.connections = new Map([primary, ...this.saved.filter(item => item.id !== primaryRingAccount)].map(item => [item.id, this.connection(item)]));
  }

  connection({ id, name }) {
    return { id, name, phase: 'disconnected', message: 'Ring-Konto verbinden.', subscriptions: [], cameras: [], locations: [], lastLoginAt: 0, retryAt: 0, pushStatus: 'not-connected' };
  }
  get vault() { return this._vault ??= new TotpVault(this.service.storage.root, !this.saved.some(item => item.token)); }
  get(id = primaryRingAccount) {
    const connection = this.connections.get(id);
    if (!connection) throw Error('Ring-Verbindung nicht gefunden.');
    return connection;
  }
  token(connection) {
    if (connection.id === primaryRingAccount) return readJson(this.service.storage.session, null)?.refreshToken;
    const sealed = this.saved.find(item => item.id === connection.id)?.token;
    return sealed ? this.vault.open(sealed) : undefined;
  }
  saveMetadata(change) {
    const next = [...this.saved.filter(item => item.id !== change.id), change];
    writeJson(this.file, next); this.saved = next;
  }
  saveToken(connection, token) {
    if (connection.id === primaryRingAccount) writeJson(this.service.storage.session, { refreshToken: token });
    else this.saveMetadata({ id: connection.id, name: connection.name, token: this.vault.seal(token) });
  }
  state() {
    return [...this.connections.values()].map(({ id, name, phase, message, cameras, pushStatus, lastEventAt }) => ({ id, name, phase, message, cameraCount: cameras.length, pushStatus, lastEventAt, hasSavedSession: id === primaryRingAccount ? Boolean(readJson(this.service.storage.session, null)?.refreshToken) : Boolean(this.saved.find(item => item.id === id)?.token) }));
  }
  save({ id, name }) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Bezeichnung für das Ring-Konto ungültig.');
    if (!id && this.connections.size >= 10) throw Error('Maximal zehn Ring-Verbindungen sind möglich.');
    const item = id ? this.get(id) : this.connection({ id: randomUUID(), name: '' });
    this.saveMetadata({ ...this.saved.find(saved => saved.id === item.id), id: item.id, name: name.trim() });
    item.name = name.trim(); this.connections.set(item.id, item);
    return item;
  }
  notify() { this.service.syncRingConnections(); }
  clearLogin(connection) {
    clearTimeout(connection.loginTimer);
    connection.loginClient?.clearTimeouts?.();
    connection.loginClient = null;
  }

  async login(id, email, password) {
    const connection = this.get(id);
    if (this.service.closed || ['connected', 'connecting', 'authenticating'].includes(connection.phase)) throw Error('Diese Ring-Verbindung ist bereits aktiv.');
    if (Date.now() - connection.lastLoginAt < 5000) throw Error('Bitte warte kurz vor dem nächsten Anmeldeversuch.');
    connection.lastLoginAt = Date.now();
    this.clearLogin(connection);
    const client = this.createLogin({ email, password, controlCenterDisplayName: displayName });
    connection.loginClient = client;
    connection.phase = 'authenticating'; this.notify();
    try {
      const auth = await waitFor(client.getCurrentAuth(), 30000, 'Ring antwortet nicht rechtzeitig.');
      if (connection.loginClient !== client || this.service.closed) return;
      this.clearLogin(connection);
      this.saveToken(connection, auth.refresh_token);
      await this.connect(connection, auth.refresh_token);
    } catch {
      if (connection.loginClient === client && client.promptFor2fa) {
        connection.phase = 'two-factor'; connection.message = 'Ring-Bestätigungscode eingeben.';
        connection.loginTimer = setTimeout(() => {
          this.clearLogin(connection); connection.phase = 'disconnected'; connection.message = 'Anmeldung abgelaufen. Erneut anmelden.'; this.notify();
        }, 5 * 60_000);
        connection.loginTimer.unref(); this.notify(); return;
      }
      this.clearLogin(connection); connection.phase = 'disconnected'; connection.message = 'Anmeldung oder Verbindung fehlgeschlagen. Zugangsdaten und Internet prüfen.'; this.notify();
      throw Error(connection.message);
    }
  }

  async verify(id, code) {
    const connection = this.get(id), client = connection.loginClient;
    if (!client || connection.phase !== 'two-factor') throw Error('Bitte starte die Anmeldung erneut.');
    connection.phase = 'authenticating'; this.notify();
    try {
      const auth = await waitFor(client.getAuth(code), 30000, 'Ring antwortet nicht rechtzeitig.');
      if (connection.loginClient !== client || this.service.closed) return;
      this.clearLogin(connection);
      this.saveToken(connection, auth.refresh_token);
      await this.connect(connection, auth.refresh_token);
    } catch {
      if (connection.loginClient === client) { connection.phase = 'two-factor'; connection.message = 'Code nicht bestätigt. Bitte prüfen und erneut eingeben.'; }
      else { connection.phase = 'disconnected'; connection.message = 'Ring-Verbindung fehlgeschlagen. Erneut anmelden.'; }
      this.notify(); throw Error(connection.message);
    }
  }

  async connect(connection, token) {
    if (this.service.closed || !token) throw Error('Für dieses Ring-Konto ist eine Anmeldung erforderlich.');
    this.release(connection);
    connection.phase = 'connecting'; connection.message = 'Verbindung zu Ring wird aufgebaut …'; connection.pushStatus = 'registering'; this.notify();
    connection.retryAt = Date.now() + 300000;
    try {
      const api = this.createApi({ refreshToken: token, ffmpegPath, cameraStatusPollingSeconds: 30, avoidSnapshotBatteryDrain: true, controlCenterDisplayName: displayName });
      connection.api = api;
      this.notify();
      const current = () => connection.api === api && !this.service.closed;
      const registration = createEventRegistration(failures => {
        if (!current()) return;
        connection.pushStatus = failures ? 'registration-failed' : 'subscribed'; this.notify();
      });
      connection.registration = registration;
      connection.subscriptions.push(api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
        if (!current()) return;
        try { this.saveToken(connection, newRefreshToken); registration.tokenChanged(newRefreshToken); }
        catch { connection.message = 'Erneuerte Ring-Sitzung konnte nicht gespeichert werden.'; }
      }));
      const locations = await waitFor(api.getLocations(), 45000, 'Kamerasuche hat zu lange gedauert.');
      if (!current()) return;
      connection.locations = locations;
      connection.cameras = locations.flatMap(location => location.cameras);
      for (const camera of connection.cameras) {
        connection.subscriptions.push(camera.onNewNotification.subscribe(notification => {
          if (!current()) return;
          const category = notification?.android_config?.category;
          const type = category === PushNotificationAction.Ding ? 'ding' : category === PushNotificationAction.Motion ? 'motion' : null;
          if (!type) return;
          connection.lastEventAt = new Date().toISOString(); connection.pushStatus = 'receiving'; connection.transportError = false;
          this.service.pushStatus = 'receiving';
          this.service.onRingNotification(camera, type, detectionInfo(notification));
        }));
      }
      registration.discovered(connection.cameras);
      connection.phase = 'connected';
      connection.message = connection.cameras.length ? 'Ring-Konto verbunden.' : 'Verbunden, keine zugänglichen Kameras gefunden.';
      this.notify();
      this.service.event('system', null, `${connection.cameras.length} Kamera(s) über Ring verbunden.`);
    } catch {
      this.release(connection);
      connection.phase = 'disconnected'; connection.message = 'Ring-Verbindung fehlgeschlagen. Internet prüfen oder neu anmelden.';
      this.notify(); throw Error(connection.message);
    }
  }

  release(connection) {
    connection.registration?.close();
    connection.subscriptions.splice(0).forEach(subscription => subscription.unsubscribe());
    const api = connection.api; connection.api = null;
    api?.disconnect();
    connection.cameras = []; connection.locations = []; connection.pushStatus = 'not-connected'; connection.transportError = false;
  }
  async resume(id) {
    const item = this.get(id);
    if (item.phase !== 'disconnected') throw Error('Bitte den aktuellen Vorgang zuerst abschließen.');
    const token = this.token(item);
    if (token) await this.connect(item, token);
  }
  async resumeAll() { await Promise.allSettled([...this.connections.keys()].map(id => this.resume(id))); }
  async reconnect(now) {
    const retryable = [...this.connections.values()].filter(item => item.retryAt < now && (item.phase === 'disconnected' || (item.transportError && !this.service.ringConnectionBusy(item))));
    await Promise.allSettled(retryable.map(async item => {
      item.retryAt = now + 300000;
      const token = this.token(item);
      if (token) await this.connect(item, token);
    }));
  }
  async logout(id, remove = false) {
    const item = this.get(id);
    if (['authenticating', 'connecting'].includes(item.phase) || this.service.ringConnectionBusy(item)) throw Error('Bitte warte, bis der laufende Vorgang für dieses Konto abgeschlossen ist.');
    if (item.id === primaryRingAccount) await unlink(this.service.storage.session).catch(error => { if (error.code !== 'ENOENT') throw error; });
    else {
      const next = this.saved.filter(saved => saved.id !== item.id);
      if (!remove) next.push({ id: item.id, name: item.name });
      writeJson(this.file, next); this.saved = next;
      if (remove) this.connections.delete(item.id);
    }
    this.clearLogin(item); this.release(item);
    item.phase = 'disconnected'; item.message = 'Ring-Konto abgemeldet.'; this.notify();
  }

  close() {
    for (const item of this.connections.values()) { this.clearLogin(item); this.release(item); }
  }
}
