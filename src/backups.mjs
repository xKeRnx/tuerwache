import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,lstat,unlink,statfs} from 'node:fs/promises';
import {readJson,writeJson} from './storage.mjs';
import {createBackupArchive,verifyBackupArchive,discardStaging} from './backup-archive.mjs';
const idOK=id=>/^[a-f0-9-]{36}$/.test(id||'');
export class Backups{
  constructor(features,config,projectRoot){this.features=features;this.config=config;this.projectRoot=projectRoot;this.root=resolve(process.env.BACKUP_DIRECTORY||join(projectRoot,'backups','snapshots'));this.staging=join(this.root,'.restore');this.jobs=new Map();this.lastScheduled=null;}
  get busy(){return [...this.jobs.values()].some(job=>job.status==='working');}
  state(){return {busy:this.busy,jobs:[...this.jobs.values()].map(job=>({...job})),lastScheduled:this.lastScheduled};}
  async list(){await mkdir(this.root,{recursive:true,mode:0o700});const result=[];for(const file of await readdir(this.root))if(/^[a-f0-9-]{36}\.twbackup$/.test(file)){const info=await lstat(join(this.root,file));if(info.isFile()&&!info.isSymbolicLink())result.push({id:file.slice(0,-9),bytes:info.size,at:info.mtime.toISOString()});}return result.sort((a,b)=>b.at.localeCompare(a.at));}
  path(id){if(!idOK(id))throw Error('Sicherung nicht gefunden.');return join(this.root,id+'.twbackup');}
  start(kind,input={}){
    if(this.busy)throw Error('Eine Sicherung oder Wiederherstellungsprüfung läuft bereits.');
    const id=randomUUID(),job={id,kind,status:'working',startedAt:new Date().toISOString()};this.jobs.set(id,job);
    const task=(kind==='create'?this.create(id,input):this.verify(id,input)).then(result=>Object.assign(job,{status:'ready',result,finishedAt:new Date().toISOString()})).catch(()=>Object.assign(job,{status:'error',message:kind==='create'?'Sicherung fehlgeschlagen. Speicherplatz und Passphrase prüfen.':'Prüfung fehlgeschlagen. Passphrase, Sicherung und Speicherplatz prüfen.'})).finally(()=>{while(this.jobs.size>20)this.jobs.delete(this.jobs.keys().next().value);});
    this.features.track(task);return {id};
  }
  async create(id,{passphrase,includeClips=this.config.value.backups.includeClips,scheduled=false}={}){
    passphrase=passphrase||this.config.passphrase();if(!passphrase)throw Error('Backup-Passphrase erforderlich.');if(typeof includeClips!=='boolean')throw Error('Clip-Auswahl ungültig.');
    await mkdir(this.root,{recursive:true,mode:0o700});
    const service=this.features.service,events=structuredClone(service.events.filter(entry=>entry.status!=='recording'));
    for(const entry of events)if(entry.recordingDecision?.status==='requested')entry.recordingDecision={status:'failed',reason:'backup-incomplete',message:'Aufnahme war beim Sichern noch nicht abgeschlossen.'};
    const records=[],pinned=[];
    const settings=structuredClone(this.features.settings.value);settings.clipsDirectory='clips';
    for(const name of ['users.json','session.json','camera-access.json','ring-accounts.json','network-cameras.json','known-faces.json','summary-usage.json','operations.json','ai-quality.json','face-suggestions.json']){
      try{records.push({name:'data/'+name,bytes:await readFile(join(service.storage.root,name))});}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    // Preserve the effective MFA/settings key inside the passphrase-encrypted
    // backup, even when this installation gets that key from the environment.
    records.push({name:'data/auth-encryption.key',bytes:Buffer.from(this.config.vault.key)});
    records.push({name:'data/settings.json',bytes:Buffer.from(JSON.stringify(settings))});
    try{
      for(const entry of events){
        if(!entry.clip)continue;
        if(!/^[a-f0-9-]{36}\.mp4$/.test(entry.clip))throw Error('Ungültiger Clip-Dateiname.');
        const original=this.features.service.events.find(item=>item.id===entry.id);entry.directory='clips';
        if(includeClips&&entry.status==='ready'&&entry.local?.status!=='deleted'){
          this.features.assertIdle(entry.id);this.features.jobs.add('backup:'+entry.id);pinned.push(entry.id);
          records.push({name:'data/clips/'+entry.clip,path:this.features.path(original)});
        }else if(entry.local?.status!=='deleted'){
          entry.local={status:'deleted',reason:'not-in-backup'};
          if(entry.cloud?.status!=='uploaded'){entry.status='expired';entry.message='Video war nicht Teil dieser Sicherung.';}
        }
        try{const bytes=await readFile(join(service.storage.root,'archive-thumbnails',entry.id+'.jpg'));records.push({name:'data/archive-thumbnails/'+entry.id+'.jpg',bytes});}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      records.push({name:'data/events.json',bytes:Buffer.from(JSON.stringify(events))});
      const result=await createBackupArchive(this.path(id),passphrase,records,{appVersion:'0.13.2',at:new Date().toISOString(),includeClips,sessionsInvalidatedOnRestore:true});
      if(scheduled){this.lastScheduled=new Date().toISOString();const indexPath=join(this.root,'scheduled.json'),index=[id,...readJson(indexPath,[]).filter(old=>old!==id&&idOK(old))];for(const old of index.slice(this.config.value.backups.keepCount))await unlink(this.path(old)).catch(error=>{if(error.code!=='ENOENT')throw error;});writeJson(indexPath,index.slice(0,this.config.value.backups.keepCount));}
      return {id,...result,includeClips};
    }finally{for(const clipId of pinned)this.features.jobs.delete('backup:'+clipId);}
  }
  async verify(verificationId,{id,passphrase}={}){
    if(!idOK(id))throw Error('Sicherung nicht gefunden.');passphrase=passphrase||this.config.passphrase();
    await mkdir(this.staging,{recursive:true,mode:0o700});
    try{const disk=await statfs(this.staging),budget=Math.max(0,disk.bavail*disk.bsize-512*1024**2);const proof=await verifyBackupArchive(this.path(id),passphrase,join(this.staging,verificationId),{maxBytes:Math.min(2*1024**4,budget)});return {id,verificationId,valid:true,files:proof.files.length,bytes:proof.bytes,createdAt:proof.metadata.at,sessionsInvalidatedOnRestore:true};}
    catch(error){await discardStaging(this.staging,verificationId);throw error;}
  }
}
