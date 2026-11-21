import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson } from './storage.mjs';

export const cameraActions = ['events', 'clips', 'live', 'export', 'push', 'capture', 'analyze', 'review', 'protect', 'delete', 'configure'];
export const defaultSite = { id: 'default', name: 'Ohne Standort' };
const clipActions = new Set(['export', 'analyze', 'review', 'protect', 'delete']);
const viewers = ['events', 'clips', 'live', 'export', 'push'];
const builtInRoles = [
  { id: 'admin', name: 'Administrator', actions: cameraActions },
  { id: 'operator', name: 'Bediener', actions: [...viewers, 'capture', 'analyze', 'review', 'protect'] },
  { id: 'viewer', name: 'Betrachter', actions: viewers },
];
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const validName = name => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 80 && !/[\x00-\x1f\x7f]/.test(name);

export class CameraAccess {
  constructor(root) {
    this.file = join(root, 'camera-access.json');
    this.value = { roles: [], sites: [], cameras: [], ...readJson(this.file, {}) };
  }

  save(next) { writeJson(this.file, next); this.value = next; }
  get roles() { return [...builtInRoles.filter(role => !this.value.roles.some(custom => custom.id === role.id)), ...this.value.roles]; }
  get sites() { return [defaultSite, ...this.value.sites]; }
  role(id) { return this.roles.find(role => role.id === id); }
  siteFor(cameraId) { return this.value.cameras.find(camera => camera.id === cameraId)?.siteId || defaultSite.id; }

  permits(user, action, cameraId) {
    if (!user || user.disabled) return false;
    if (user.role === 'admin') return true;
    if (clipActions.has(action) && !this.permits(user, 'clips', cameraId)) return false;
    const role = this.role(user.role);
    if (!role) return false;
    const site = cameraId ? this.siteFor(cameraId) : null;
    return this.scopeDecision(user.cameraAccess, action, cameraId, site)
      ?? this.scopeDecision(role.permissions, action, cameraId, site)
      ?? role.actions.includes(action);
  }

  scopeDecision(access, action, cameraId, site) {
    if (!access) return undefined;
    const matching = access.rules.filter(rule => rule.scope === 'all' || (cameraId && (rule.scope === 'camera' ? rule.id === cameraId : rule.id === site)));
    if (matching.some(rule => rule.deny.includes(action))) return false;
    if (matching.some(rule => rule.allow.includes(action))) return true;
    if (access.restricted && (!cameraId || (!access.cameras.includes(cameraId) && !access.sites.includes(site)))) return false;
    return undefined;
  }

  normalizeAccess(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.restricted !== 'boolean') throw Error('Kamerafreigabe ungültig.');
    const ids = (list, known) => {
      if (!Array.isArray(list) || list.length > 200 || list.some(id => !validId(id) || !known(id))) throw Error('Standort oder Kamera unbekannt.');
      return [...new Set(list)];
    };
    const siteKnown = id => this.sites.some(site => site.id === id);
    const cameraKnown = id => this.value.cameras.some(camera => camera.id === id);
    if (!Array.isArray(value.rules) || value.rules.length > 100) throw Error('Kameraregeln ungültig.');
    const rules = value.rules.map(({ scope, id, allow, deny } = {}) => {
      if (!['all', 'site', 'camera'].includes(scope) || (scope === 'camera' && !cameraKnown(id)) || (scope === 'site' && !siteKnown(id))) throw Error('Bereich der Kameraregel ungültig.');
      return { scope, ...(scope !== 'all' && { id }), allow: this.normalizeActions(allow), deny: this.normalizeActions(deny) };
    });
    return { restricted: value.restricted, cameras: ids(value.cameras, cameraKnown), sites: ids(value.sites, siteKnown), rules };
  }

  normalizeActions(actions) {
    if (!Array.isArray(actions) || actions.length > cameraActions.length || actions.some(action => !cameraActions.includes(action))) throw Error('Kamerarechte ungültig.');
    return [...new Set(actions)];
  }

  saveRole({ id, name, actions, permissions }) {
    if (id !== undefined && (id === 'admin' || !this.role(id))) throw Error('Diese Rolle kann nicht geändert werden.');
    if (!validName(name) || (id === undefined && this.value.roles.length >= 50)) throw Error('Rollenname oder Anzahl ungültig.');
    if (this.roles.some(role => role.id !== id && role.name.toLowerCase() === name.trim().toLowerCase())) throw Error('Rollenname bereits vergeben.');
    const scope = permissions === undefined ? this.role(id)?.permissions : this.normalizeAccess(permissions);
    const role = { id: id || randomUUID(), name: name.trim(), actions: this.normalizeActions(actions), ...(scope && { permissions: scope }) };
    this.save({ ...this.value, roles: [...this.value.roles.filter(item => item.id !== role.id), role] });
    return role;
  }

  removeRole(id, users) {
    if (builtInRoles.some(role => role.id === id) || !this.role(id) || users.some(user => user.role === id)) throw Error('Nur unbenutzte eigene Rollen können entfernt werden.');
    this.save({ ...this.value, roles: this.value.roles.filter(role => role.id !== id) });
  }

  saveSite({ id, name }) {
    if (!validName(name) || (id && !this.value.sites.some(site => site.id === id)) || (!id && this.value.sites.length >= 100)) throw Error('Standort oder Name ungültig.');
    const site = { ...this.value.sites.find(item => item.id === id), id: id || randomUUID(), name: name.trim() };
    this.save({ ...this.value, sites: [...this.value.sites.filter(item => item.id !== site.id), site] });
    return site;
  }

  assign(cameraId, siteId) {
    if (!this.sites.some(site => site.id === siteId) || !this.value.cameras.some(camera => camera.id === cameraId)) throw Error('Kamera oder Standort nicht gefunden.');
    this.save({ ...this.value, cameras: this.value.cameras.map(camera => camera.id === cameraId ? { ...camera, siteId } : camera) });
  }

  observe(cameras, events = [], locations = []) {
    const updated = new Map(this.value.cameras.map(camera => [camera.id, camera]));
    const sites = [...this.value.sites];
    const siteByCamera = new Map();
    for (const location of locations) {
      const ringLocation = String(location.id ?? '');
      if (!ringLocation || !validName(location.name) || !location.cameras.length) continue;
      let site = sites.find(item => item.ringLocation === ringLocation);
      if (!site && sites.length < 100) { site = { id: randomUUID(), name: location.name.trim(), ringLocation }; sites.push(site); }
      if (site) for (const camera of location.cameras) siteByCamera.set(String(camera.id), site.id);
    }
    for (const event of events) {
      if (!validId(event.cameraId) || !validName(event.camera)) continue;
      const previous = updated.get(event.cameraId) || { id: event.cameraId, name: event.camera };
      const last = this.lastEvent(previous, event);
      updated.set(event.cameraId, last);
    }
    for (const camera of cameras) if (validId(String(camera.id)) && validName(camera.name)) {
      const id = String(camera.id);
      const previous = updated.get(id);
      const siteId = previous?.siteId || siteByCamera.get(id);
      updated.set(id, { ...previous, id, name: camera.name.trim(), ...(siteId && { siteId }) });
    }
    const next = [...updated.values()];
    if (sites.length !== this.value.sites.length || JSON.stringify(next) !== JSON.stringify(this.value.cameras)) this.save({ ...this.value, cameras: next, sites });
  }

  lastEvent(camera, event) {
    if (!['ding', 'motion'].includes(event.type) || (camera.lastEvent && camera.lastEvent.at >= event.at)) return camera;
    return { ...camera, lastEvent: { id: event.id, type: event.type, at: event.at } };
  }

  record(event) {
    const existing = this.value.cameras.find(camera => camera.id === event.cameraId);
    if (!existing) { this.observe([], [event]); return; }
    const next = this.lastEvent(existing, event);
    if (next !== existing) this.save({ ...this.value, cameras: this.value.cameras.map(item => item === existing ? next : item) });
  }

  dashboard(cameras, user) {
    const active = new Map(cameras.map(camera => [String(camera.id), camera]));
    const maySee = (action, id) => !user || this.permits(user, action, id);
    const groups = new Map(this.sites.map(({ id, name }) => [id, { id, name, cameras: [] }]));
    for (const stored of this.value.cameras) {
      const permissions = cameraActions.filter(action => maySee(action, stored.id));
      if (!permissions.length) continue;
      const camera = active.get(stored.id);
      const group = groups.get(this.siteFor(stored.id)) || groups.get(defaultSite.id);
      group.cameras.push({ id: stored.id, name: stored.name, permissions,
        status: !camera ? 'disconnected' : camera.features?.monitoring === false ? 'paused' : camera.offline ? 'offline' : 'online',
        lastEvent: maySee('events', stored.id) ? stored.lastEvent || null : null });
    }
    return [...groups.values()].filter(site => site.cameras.length || user?.role === 'admin');
  }
}
