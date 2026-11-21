import { extractJpeg } from './media.mjs';
import { join } from 'node:path';
import {readFile} from 'node:fs/promises';

export function clipPage(events, { cursor = '', limit = 24, cameraId = '' } = {}) {
  const entries = events.filter(event => event.clip && event.status === 'ready' && (!cameraId || event.cameraId === cameraId));
  const start = cursor ? entries.findIndex(event => event.id === cursor) + 1 : 0;
  if (cursor && !start) throw new Error('Archivseite hat sich geändert. Bitte neu laden.');
  const end = start + Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 24, 48));
  return { items: entries.slice(start,end).map(({ directory,...entry })=>entry), total:entries.length, nextCursor:end<entries.length?entries[end-1].id:null };
}
export class ClipThumbnails {
  constructor(service) { this.service=service; this.cache=new Map(); this.pending=new Map(); this.running=0; }
  async get(id) {
    const entry=this.service.events.find(entry=>entry.id===id&&entry.clip&&entry.status==='ready');
    if(!entry)throw new Error('Clip nicht gefunden.');
    if(this.cache.has(id))return this.cache.get(id);
    if(entry.local?.status==='deleted')return readFile(join(this.service.storage.root,'archive-thumbnails',entry.id+'.jpg'));
    if(this.pending.has(id))return this.pending.get(id);
    if(this.running>=2)throw new Error('Vorschaubilder werden vorbereitet. Bitte kurz warten.');
    this.running++;
    const task=extractJpeg(this.service.features?.path(entry)||join(entry.directory||this.service.storage.clips,entry.clip),{atSeconds:1,maxWidth:640}).then(bytes=>{
      if(this.cache.size>=48)this.cache.delete(this.cache.keys().next().value);
      this.cache.set(id,bytes);return bytes;
    }).finally(()=>{this.running--;this.pending.delete(id);});
    this.pending.set(id,task);return task;
  }
}
