import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson } from './storage.mjs';
import { accountVersion } from './accounts.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const publicUser = ({ id, name, role }) => ({ id, name, role });

// Native clients have no ambient browser cookies. Persist only token hashes.
export class MobileSessions {
  constructor(root, accounts) {
    this.file = join(root, 'mobile-sessions.json'); this.accounts = accounts;
    this.sessions = readJson(this.file, []); this.prune();
  }
  valid(session) {
    const user = this.accounts.principal(session.userId);
    return session.until > Date.now() && user && accountVersion(user) === session.version ? user : null;
  }
  prune() { const count = this.sessions.length; this.sessions = this.sessions.filter(session => this.valid(session)); if (this.sessions.length !== count) this.save(); }
  save() { writeJson(this.file, this.sessions); }
  issue(user, name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Einen Gerätenamen mit höchstens 80 Zeichen angeben.');
    this.prune();
    if (this.sessions.filter(session => session.userId === user.id).length >= 20) throw new Error('Zuerst ein altes Handy unter Handy-App abmelden.');
    const token = randomBytes(32).toString('hex');
    const session = { id: randomUUID(), userId: user.id, name: name.trim(), hash: digest(token), version: accountVersion(user), until: Date.now() + 30 * 86400_000, createdAt: new Date().toISOString(), subscriptions: {} };
    this.sessions.push(session); this.save();
    return { token, expiresAt: new Date(session.until).toISOString(), deviceId: session.id, user: publicUser(user) };
  }
  current(authorization = '') {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
    if (!token) return null;
    const session = this.sessions.find(session => session.hash === digest(token));
    const user = session && this.valid(session);
    return user ? { ...publicUser(user), mobileId: session.id } : null;
  }
  list(user) {
    this.prune();
    return this.sessions.filter(session => session.userId === user.id).map(({ id, name, createdAt, until, subscriptions, pushToken, lastPush }) => ({ id, name, createdAt, expiresAt: new Date(until).toISOString(), subscriptions: Object.fromEntries(Object.entries(subscriptions).filter(([cameraId]) => this.accounts.permits(user, 'push', cameraId))), pushEnabled: Boolean(pushToken), lastPush }));
  }
  owned(id, user) {
    const session = this.sessions.find(session => session.id === id && session.userId === user.id && this.valid(session));
    if (!session) throw new Error('Handy-Anmeldung nicht gefunden.'); return session;
  }
  revoke(id, user) { this.owned(id, user); this.sessions = this.sessions.filter(session => session.id !== id); this.save(); }
  configure(user, { token, subscriptions, language }, cameraIds) {
    const session = this.owned(user.mobileId, user);
    if (token !== undefined && (typeof token !== 'string' || (token && !/^(Expo|Exponent)PushToken\[[a-zA-Z0-9_-]{10,200}\]$/.test(token)))) throw new Error('Ungültiges Expo-Push-Token.');
    if (!subscriptions || typeof subscriptions !== 'object' || Array.isArray(subscriptions) || Object.keys(subscriptions).length > 100) throw new Error('Kamera-Auswahl fehlt.');
    const next = {};
    for (const [id, kinds] of Object.entries(subscriptions)) {
      if (!cameraIds.includes(id) || !Array.isArray(kinds) || kinds.some(kind => !['ding', 'clip', 'person', 'summary'].includes(kind))) throw new Error('Push-Auswahl ungültig.');
      next[id] = [...new Set(kinds)];
    }
    if (token !== undefined) {
      // A push address belongs to only the latest authenticated device session.
      if (token) for (const item of this.sessions) if (item !== session && item.pushToken === token) delete item.pushToken;
      session.pushToken = token;
    }
    if(language!==undefined){if(!['de','en'].includes(language))throw Error('Ungültige Sprache.');session.language=language;}
    session.subscriptions = next; this.save();
  }
}
