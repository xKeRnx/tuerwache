import { createHash, randomBytes, randomUUID, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readJson, writeJson } from './storage.mjs';
import { TotpVault, base32, verifyTotp } from './totp.mjs';
import { CameraAccess } from './camera-access.mjs';
import { defaultQuietHours, normalizeQuietHours } from './quiet-hours.mjs';
const scrypt = promisify(derive);
const safe = ({ id, name, role }) => ({ id, name, role });
const hash = value => createHash('sha256').update(value).digest('hex');
const validName = name => typeof name === 'string' && /^[\p{L}\p{N}_.@ -]{2,60}$/u.test(name.trim());
export const accountVersion = user => hash(`${user.hash}:${user.role}${user.mfaVersion?':'+user.mfaVersion:''}${user.sessionVersion?':'+user.sessionVersion:''}`);

export class MfaRequiredError extends Error {
  constructor() { super('Aktuellen 2FA-Code oder unbenutzten Wiederherstellungscode eingeben.'); }
}

export class Accounts {
  constructor(root) { this.file = join(root, 'users.json'); this.users = readJson(this.file, []); this.cameraAccess = new CameraAccess(root); this.sessionsFile=join(root,'web-sessions.json'); this.sessions = new Map(readJson(this.sessionsFile, [])); this.attemptsFile=join(root,'login-attempts.json'); this.attempts = new Map(readJson(this.attemptsFile, [])); this.logins=0; }
  get setupRequired() { return this.users.length === 0; }
  get vault(){return this._vault??=new TotpVault(join(this.file,'..'),!this.users.some(user=>user.totp||user.pendingTotp));}
  mfaStatus(id){return Boolean(this.users.find(user=>user.id===id)?.totp);}
  list() { return this.users.map(user=>({...safe(user),mfaEnabled:Boolean(user.totp),disabled:Boolean(user.disabled),cameraAccess:user.cameraAccess})); }
  principal(id) { return this.users.find(user => user.id === id && !user.disabled); }
  permits(user, action, cameraId) { return this.cameraAccess.permits(this.principal(user?.id), action, cameraId); }
  quietHours(user) { return this.principal(user?.id)?.quietHours || defaultQuietHours; }
  updateQuietHours(user, value) {
    const account = this.principal(user?.id);
    if (!account) throw Error('Bitte anmelden.');
    account.quietHours = normalizeQuietHours(value);
    this.save();
  }
  save() { writeJson(this.file, this.users); }
  async password(password, salt = randomBytes(16).toString('hex')) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Passwort muss 12 bis 256 Zeichen lang sein.');
    return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
  }
  async add({ name, password, role, permissions }, first = false) {
    if (first !== this.setupRequired) throw new Error('Benutzerverwaltung erst nach der Einrichtung verwenden.');
    if (!validName(name) || !this.cameraAccess.role(role)) throw new Error('Benutzername oder Rolle ungültig.');
    name = name.trim();
    if (this.users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw new Error('Benutzername bereits vergeben.');
    const credentials = await this.password(password);
    if (first !== this.setupRequired || !this.cameraAccess.role(role) || this.users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw new Error('Benutzer konnte nicht angelegt werden. Rolle und Name prüfen.');
    const user = { id: randomUUID(), name, role: first ? 'admin' : role, ...credentials };
    if (!first && permissions !== undefined) user.cameraAccess = this.cameraAccess.normalizeAccess(permissions);
    this.users.push(user); this.save(); return user;
  }
  async login(name, password, address, otp='') {
    const now = Date.now();
    for (const [key, attempt] of this.attempts) if (attempt.until < now) this.attempts.delete(key);
    const addressKey=`ip:${address}`,accountKey=`account:${hash(String(name).toLowerCase())}:${address}`;
    const attempt = this.attempts.get(accountKey) ?? { count: 0, until: now + 15 * 60_000 },ipAttempt=this.attempts.get(addressKey)??{count:0,until:now+15*60_000};
    if (++attempt.count > 8||++ipAttempt.count>60) throw new Error('Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
    this.attempts.set(accountKey, attempt);this.attempts.set(addressKey,ipAttempt);
    while(this.attempts.size>5000)this.attempts.delete(this.attempts.keys().next().value);
    writeJson(this.attemptsFile,[...this.attempts]);
    if(this.logins>=4)throw new Error('Anmeldung ausgelastet. Bitte kurz warten.');
    const user = this.users.find(u => u.name.toLowerCase() === String(name).toLowerCase());
    const salt = user?.salt ?? 'invalid-user-fixed-salt';
    this.logins++; let candidate;
    try { candidate = await this.password(password, salt); } finally { this.logins--; }
    if (!user || !timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(user.hash, 'hex')) || user.disabled || !this.users.includes(user)) throw new Error('Benutzername oder Passwort falsch.');
    if(user.totp){
      if (otp === '') throw new MfaRequiredError();
      const recovery=user.recoveryCodes?.indexOf(hash(String(otp).replaceAll('-','').toLowerCase()))??-1;
      const step=recovery>=0?null:verifyTotp(this.vault.open(user.totp),otp,user.lastTotpStep??-1);
      if(step===null&&recovery<0)throw new Error('Aktuellen 2FA-Code oder unbenutzten Wiederherstellungscode eingeben.');
      if(step!==null)user.lastTotpStep=step;else user.recoveryCodes.splice(recovery,1);this.save();
    }
    this.attempts.delete(accountKey);ipAttempt.count=Math.max(0,ipAttempt.count-1);if(!ipAttempt.count)this.attempts.delete(addressKey);writeJson(this.attemptsFile,[...this.attempts]); return user;
  }
  session(user) {
    const now = Date.now();
    for (const [key, value] of this.sessions) if (value.until < now) this.sessions.delete(key);
    const token = randomBytes(32).toString('hex');
    const own=[...this.sessions.entries()].filter(([,value])=>value.userId===user.id);for(const [key] of own.slice(0,Math.max(0,own.length-19)))this.sessions.delete(key);
    this.sessions.set(hash(token), { userId: user.id, version:accountVersion(user), csrf: randomBytes(32).toString('hex'), until: now + 12 * 3600_000 }); writeJson(this.sessionsFile,[...this.sessions]);return token;
  }
  current(cookie = '') {
    const token = /(?:^|;\s*)tw_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1];
    if(!token)return null;
    const session = this.sessions.get(hash(token));
    if (!session || session.until < Date.now()) { this.sessions.delete(hash(token)); return null; }
    const user = this.principal(session.userId);
    return user && session.version===accountVersion(user) ? { ...safe(user), csrf: session.csrf, token } : null;
  }
  end(token) { if(token)this.sessions.delete(hash(token));writeJson(this.sessionsFile,[...this.sessions]); }
  async startMfa(principal,password,address){
    const user=await this.login(principal.name,password,address);
    if(user.totp)throw new Error('2FA ist bereits eingerichtet.');
    const secret=base32(randomBytes(20));user.pendingTotp={secret:this.vault.seal(secret),until:Date.now()+600000};this.save();
    return {secret,uri:`otpauth://totp/${encodeURIComponent('Türwache:'+user.name)}?secret=${secret}&issuer=T%C3%BCrwache&algorithm=SHA1&digits=6&period=30`};
  }
  confirmMfa(principal,otp){
    const user=this.users.find(user=>user.id===principal.id),pending=user?.pendingTotp;
    if(!pending||pending.until<Date.now())throw new Error('2FA-Einrichtung abgelaufen. Bitte erneut starten.');
    pending.attempts=(pending.attempts||0)+1;if(pending.attempts>8){delete user.pendingTotp;this.save();throw new Error('Zu viele Versuche. 2FA-Einrichtung erneut starten.');}
    const step=verifyTotp(this.vault.open(pending.secret),otp);if(step===null){this.save();throw new Error('2FA-Code stimmt nicht.');}
    const codes=Array.from({length:10},()=>randomBytes(10).toString('hex'));
    user.totp=pending.secret;user.lastTotpStep=step;user.recoveryCodes=codes.map(hash);user.mfaVersion=randomUUID();delete user.pendingTotp;this.revoke(user.id);this.save();return {user,codes};
  }
  async disableMfa(principal,password,otp,address){const user=await this.login(principal.name,password,address,otp);delete user.totp;delete user.pendingTotp;delete user.recoveryCodes;delete user.lastTotpStep;user.mfaVersion=randomUUID();this.revoke(user.id);this.save();}
  revoke(id) { for (const [token, session] of this.sessions) if (session.userId === id) this.sessions.delete(token);writeJson(this.sessionsFile,[...this.sessions]); }
  async update({ id, name, role, password, disabled, permissions, revokeSessions = false, remove = false }) {
    if ((name !== undefined && !validName(name)) || [remove, revokeSessions].some(value => typeof value !== 'boolean') || (disabled !== undefined && typeof disabled !== 'boolean')) throw Error('Benutzerdaten ungültig.');
    const credentials = password !== undefined ? await this.password(password) : null;
    const user = this.users.find(u => u.id === id);
    if (!user) throw new Error('Benutzer nicht gefunden.');
    if (role !== undefined && !this.cameraAccess.role(role)) throw Error('Rolle ungültig.');
    if (name && this.users.some(u => u !== user && u.name.toLowerCase() === name.trim().toLowerCase())) throw Error('Benutzername bereits vergeben.');
    const nextRole = role ?? user.role;
    const access = permissions === undefined ? user.cameraAccess : this.cameraAccess.normalizeAccess(permissions);
    if (user.role === 'admin' && !user.disabled && (remove || disabled || nextRole !== 'admin') && this.users.filter(u => u.role === 'admin' && !u.disabled).length <= 1) throw Error('Mindestens ein Administrator muss erhalten bleiben.');
    const revoke = Boolean(remove || revokeSessions || credentials || (disabled !== undefined && Boolean(user.disabled) !== disabled) || user.role !== nextRole);
    if (remove) this.users = this.users.filter(u => u !== user);
    else {
      Object.assign(user, credentials, { role: nextRole, name: name?.trim() ?? user.name, disabled: disabled ?? Boolean(user.disabled), cameraAccess: access });
      if (revoke) user.sessionVersion = randomUUID();
    }
    this.save();
    if (revoke) this.revoke(id);
  }
}
