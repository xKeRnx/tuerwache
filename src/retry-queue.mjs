import {join} from 'node:path';
import {readJson,writeJson} from './storage.mjs';
export class RetryQueue{
  constructor(root,config,handler){this.file=join(root,'retry-queue.json');this.config=config;this.handler=handler;this.running=false;this.jobs=readJson(this.file,[]).map(job=>job.status==='working'?{...job,status:'pending',runAfter:Date.now()+30000}:job);}
  save(){writeJson(this.file,this.jobs);}
  enqueue(type,eventId,{notify=false,configurationId}={}){
    if(!this.config.value.retries.enabled||!['ai','summary','upload'].includes(type))return;
    const id=type+':'+eventId;if(this.jobs.some(job=>job.id===id&&['pending','working'].includes(job.status)))return;
    this.jobs=this.jobs.filter(job=>job.id!==id).slice(-199);
    this.jobs.push({id,type,eventId,notify,configurationId,attempts:0,status:'pending',createdAt:new Date().toISOString(),runAfter:Date.now()+30000});this.save();
  }
  state(){return {running:this.running,jobs:this.jobs.slice(-40).toReversed()};}
  async run(now=Date.now()){
    if(this.running||!this.config.value.retries.enabled)return;this.running=true;
    try{for(const job of this.jobs.filter(job=>job.status==='pending'&&job.runAfter<=now).slice(0,5)){
      job.status='working';job.attempts++;this.save();
      try{const result=await this.handler(job);job.status=result?.skip?'skipped':'done';job.finishedAt=new Date().toISOString();}
      catch{job.status=job.attempts>=this.config.value.retries.maxAttempts?'failed':'pending';job.runAfter=now+[30000,120000,600000,1800000,3600000][Math.min(job.attempts,4)];job.message='Erneuter Versuch fehlgeschlagen. Einstellungen und Ereignis prüfen.';}
      this.save();
    }}finally{this.running=false;}
  }
}
