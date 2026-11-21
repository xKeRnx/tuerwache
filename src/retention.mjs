import {join,resolve,dirname} from 'node:path';
import {lstat,unlink,mkdir,writeFile} from 'node:fs/promises';
import {extractJpeg} from './media.mjs';
const day=86400000;
export class Retention{
  constructor(features,config){this.features=features;this.config=config;this.running=false;this.last=null;}
  async files(){
    const result=[];
    for(const entry of this.features.service.events.filter(entry=>entry.clip&&entry.status==='ready')){
      let size=0,exists=false;
      if(entry.local?.status!=='deleted')try{const info=await lstat(this.features.path(entry));if(info.isFile()&&!info.isSymbolicLink()){size=info.size;exists=true;}}catch(error){if(error.code!=='ENOENT')throw error;}
      result.push({entry,size,exists,cloudSize:entry.cloud?.status==='uploaded'?Number(entry.cloud.bytes||entry.bytes)||0:0});
    }
    return result;
  }
  async preview(now=Date.now()){
    const policy=this.config.value.retention,files=await this.files(),local=[],cloud=[];
    const usedBytes=files.reduce((sum,file)=>sum+file.size,0),protectedBytes=files.filter(file=>file.entry.protected).reduce((sum,file)=>sum+file.size,0);
    const usedCloudBytes=files.reduce((sum,file)=>sum+file.cloudSize,0),protectedCloudBytes=files.filter(file=>file.entry.protected).reduce((sum,file)=>sum+file.cloudSize,0);let remaining=usedBytes,cloudRemaining=usedCloudBytes;
    for(const file of files.toSorted((a,b)=>a.entry.at.localeCompare(b.entry.at))){
      const entry=file.entry,age=now-Date.parse(entry.at);
      if(entry.protected)continue;
      if(file.exists&&policy.local.enabled&&(age>policy.local.days*day||remaining>policy.local.maxGiB*1024**3)){local.push({id:entry.id,bytes:file.size,reason:age>policy.local.days*day?'age':'quota'});remaining-=file.size;}
      if(entry.cloud?.status==='uploaded'&&policy.cloud.enabled&&(age>policy.cloud.days*day||(policy.cloud.maxGiB>0&&cloudRemaining>policy.cloud.maxGiB*1024**3))){cloud.push({id:entry.id,bytes:file.cloudSize,reason:age>policy.cloud.days*day?'age':'quota'});cloudRemaining-=file.cloudSize;}
    }
    return {usedCloudBytes,protectedCloudBytes,cloudRemainingBytes:cloudRemaining,cloudQuotaBlocked:policy.cloud.enabled&&policy.cloud.maxGiB>0&&cloudRemaining>policy.cloud.maxGiB*1024**3,usedBytes,protectedBytes,protectedCount:files.filter(file=>file.entry.protected).length,local,cloud,remainingBytes:remaining,quotaBlocked:policy.local.enabled&&remaining>policy.local.maxGiB*1024**3};
  }
  async run(){
    if(this.running)throw Error('Aufbewahrung wird bereits geprüft.');this.running=true;
    const result={at:new Date().toISOString(),localDeleted:0,cloudDeleted:0,skipped:0,errors:0};
    try{
      const plan=await this.preview();
      for(const {id}of plan.cloud){const entry=this.features.entry(id);if(entry.protected)continue;
        try{this.features.assertIdle(id);this.features.jobs.add('retention:'+id);await this.features.cloud.remove(this.features.settings.value.cloud,entry.cloud);entry.cloud={...entry.cloud,status:'deleted',deletedAt:new Date().toISOString(),reason:'retention'};if(entry.local?.status==='deleted'){entry.status='expired';entry.message='Aufnahme gemäß Aufbewahrungsregeln abgelaufen.';}result.cloudDeleted++;this.features.save();}catch{result.errors++;}finally{this.features.jobs.delete('retention:'+id);}
      }
      for(const {id}of plan.local){
        const entry=this.features.entry(id);if(entry.protected)continue;
        try{
          this.features.assertIdle(id);this.features.jobs.add('retention:'+id);
          const path=resolve(this.features.path(entry)),directory=resolve(entry.directory||this.features.service.storage.clips);
          if(!/^[a-f\d-]{36}\.mp4$/.test(entry.clip)||dirname(path)!==directory)throw Error('Unsafe clip path');
          const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe clip file');
          if(entry.cloud?.status==='uploaded'){
            const config=this.features.settings.value.cloud;
            if(!config.accessKeyId||!config.secretAccessKey||entry.cloud.endpoint!==config.endpoint||entry.cloud.bucket!==config.bucket||entry.cloud.region!==config.region){result.skipped++;continue;}
            try{const bytes=await extractJpeg(path,{atSeconds:0,maxWidth:640});const target=join(this.features.service.storage.root,'archive-thumbnails');await mkdir(target,{recursive:true,mode:0o700});await writeFile(join(target,entry.id+'.jpg'),bytes,{mode:0o600});}catch{/* Cloud video remains accessible even without a thumbnail. */}
          }
          await unlink(path);entry.local={status:'deleted',at:new Date().toISOString(),reason:'retention'};
          if(entry.cloud?.status!=='uploaded'){entry.status='expired';entry.message='Aufnahme gemäß Aufbewahrungsregeln abgelaufen.';}
          result.localDeleted++;this.features.save();
        }catch{result.errors++;}finally{this.features.jobs.delete('retention:'+id);}
      }
      this.last={...result,quotaBlocked:(await this.preview()).quotaBlocked};return this.last;
    }finally{this.running=false;}
  }
}
