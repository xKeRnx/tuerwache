import {statfs} from 'node:fs/promises';
import {OperationsConfig} from './operations-config.mjs';
import {Retention} from './retention.mjs';
import {Backups} from './backups.mjs';
import {RetryQueue} from './retry-queue.mjs';
export class Operations{
  constructor(features,projectRoot){this.features=features;this.config=new OperationsConfig(features.service.storage.root);this.retention=new Retention(features,this.config);this.backups=new Backups(features,this.config,projectRoot);this.retry=new RetryQueue(features.service.storage.root,this.config,job=>this.retryJob(job));this.health={checkedAt:null,alerts:[]};this.running=null;this.lastRetention=0;this.nextReconnect=0;if(features.service.mediaHub)features.service.mediaHub.limit=this.config.value.recording.maxCameras;}
  state(){return {config:this.config.public(),health:this.health,retention:{running:this.retention.running,last:this.retention.last},backups:this.backups.state(),retry:this.retry.state()};}
  update(input){const value=this.config.update(input);if(this.features.service.mediaHub)this.features.service.mediaHub.limit=value.recording.maxCameras;this.features.service.networkCameras?.reconcile();return value;}
  start(){if(this.timer)return;this.timer=setInterval(()=>this.tick(),30000);this.timer.unref();this.tick();}
  tick(){if(this.running||this.features.closed)return this.running;this.running=this.check().catch(()=>{this.health={checkedAt:new Date().toISOString(),alerts:[{id:'monitor-error',severity:'warning',message:'Betriebsprüfung fehlgeschlagen. Serverprotokoll und Speicher prüfen.'}]};}).finally(()=>{this.running=null;});return this.running;}
  async check(){
    const service=this.features.service,now=Date.now(),alerts=[];
    const disk=await statfs(this.features.settings.value.clipsDirectory),freeBytes=disk.bavail*disk.bsize;
    if(freeBytes<this.config.value.monitor.diskWarnGiB*1024**3)alerts.push({id:'disk-low',severity:'warning',message:'Wenig freier Speicher für Aufnahmen.'});
    const ringExpected = service.cameras.some(camera => camera.source !== 'network') || !service.networkCameras?.cameras.size ||
      service.ringAccounts?.state().some(account => account.hasSavedSession);
    if(ringExpected&&service.phase!=='connected')alerts.push({id:'ring-disconnected',severity:'warning',message:'Keine aktive Ring-Verbindung.'});
    if(ringExpected&&(service.pushTransport?.status==='error'||['registration-failed','not-connected','disconnected'].includes(service.pushStatus)))alerts.push({id:'events-disconnected',severity:'warning',message:'Ring-Ereignisempfang ist nicht verbunden oder nicht bestätigt.'});
    for(const camera of service.cameras)if(camera.isOffline&&camera.status!=='paused'&&camera.status!=='limited')alerts.push({id:'offline-'+camera.id,severity:'warning',message:'Kamera offline: '+camera.name});
    const jobs=this.features.jobs.state?.()||[];
    for(const job of jobs)if(job.seconds>({ai:150,summary:300,cloud:180,discord:90}[job.key.split(':')[0]]||600))alerts.push({id:'long-job-'+job.key,severity:'warning',message:'Ein Verarbeitungsschritt dauert ungewöhnlich lange.',job:job.key,seconds:job.seconds});
    if(this.config.value.monitor.silenceHours&&service.lastEventAt&&now-Date.parse(service.lastEventAt)>this.config.value.monitor.silenceHours*3600000)alerts.push({id:'event-silence',severity:'info',message:'Länger kein Kameraereignis empfangen. Das kann auch eine ruhige Szene bedeuten.'});
    const deliveryErrors=service.events.filter(entry=>Date.parse(entry.at)>now-86400000).filter(entry=>Object.values(entry.discord||{}).some(delivery=>delivery.status==='error'));if(deliveryErrors.length)alerts.push({id:'delivery-errors',severity:'warning',message:'Discord-Meldungen fehlgeschlagen. Details und manuelle Wiederholung beim jeweiligen Clip prüfen.'});
    if(service.mobilePush?.sessions.sessions.some(session=>service.mobilePush.sessions.valid(session)&&session.lastPush?.status==='error'))alerts.push({id:'push-errors',severity:'warning',message:'Handy-Push fehlgeschlagen. Gerätestatus unter Handy-App prüfen.'});
    const plan=await this.retention.preview();if(plan.quotaBlocked||plan.cloudQuotaBlocked)alerts.push({id:'quota-protected',severity:'warning',message:'Speicherlimit durch geschützte oder noch verarbeitete Clips nicht erreichbar.'});
    this.health={...(this.health.alertDelivery?{alertDelivery:this.health.alertDelivery}:{}),checkedAt:new Date().toISOString(),freeBytes,usedBytes:plan.usedBytes,protectedBytes:plan.protectedBytes,alerts,jobs,lastEventAt:service.lastEventAt||null};
    if(this.config.value.monitor.enabled&&!service.closed)await service.ringAccounts?.reconnect(now);
    await this.notifyAlerts(alerts);
    await service.mobilePush?.checkReceipts();
    await this.retry.run();
    if(now-this.lastRetention>300000&&!this.backups.busy){this.lastRetention=now;if(this.config.value.retention.local.enabled||this.config.value.retention.cloud.enabled)await this.retention.run();}
    if(this.config.value.backups.enabled&&!this.backups.busy&&!service.captureTasks?.size&&!this.features.jobs.size){const latest=(await this.backups.list())[0];if(!latest||now-Date.parse(latest.at)>=this.config.value.backups.intervalHours*3600000)this.backups.start('create',{scheduled:true});}
  }
  async notifyAlerts(alerts){
    const warnings=alerts.filter(alert=>alert.severity==='warning'),now=Date.now(),config=this.features.settings.value.discord;
    if(!this.config.value.monitor.discordAlerts||!config.enabled||!config.webhookUrl||!warnings.length||now-(this.lastAlertSent||0)<1800000)return;
    this.lastAlertSent=now;const fingerprint=warnings.map(alert=>alert.id).sort().join(',');
    const task=this.features.discord.tail.then(async()=>{
      if(!this.config.value.monitor.discordAlerts||!this.features.settings.value.discord.enabled||this.features.settings.value.discord.webhookUrl!==config.webhookUrl)return;
      try{await this.features.discord.client.send(config.webhookUrl,'⚠️ Türwache: '+warnings.length+' Betriebswarnung(en). Details nach Anmeldung unter Betrieb prüfen.');this.health.alertDelivery={status:'sent',at:new Date().toISOString(),fingerprint};}
      catch{this.health.alertDelivery={status:'error',at:new Date().toISOString(),message:'Betriebswarnung nicht bestätigt; kein automatischer erneuter Versand.'};}
    });this.features.discord.tail=task.catch(()=>{});await this.features.track(task);
  }
  async retryJob(job){
    const entry=this.features.entry(job.eventId),profile=this.features.settings.profile(entry.cameraId);
    if(!profile.monitoring||entry.local?.status==='deleted'||entry.status!=='ready')return {skip:true};
    if(job.type==='ai'){if(entry.ai?.status==='ready')return;await this.features.analyze(entry.id,{notify:job.notify,retryAttempt:true});if(entry.ai?.status!=='ready')throw Error('AI retry failed');}
    if(job.type==='upload'){if(entry.cloud?.status==='uploaded')return;await this.features.upload(entry.id,{retryAttempt:true});if(entry.cloud?.status!=='uploaded')throw Error('Upload retry failed');}
    if(job.type==='summary'){if(entry.summary?.status==='ready')return;if(job.configurationId&&profile.summaryProvider!==job.configurationId)return {skip:true};await this.features.summaries.enqueue(entry.id,true,{retryAttempt:true,notify:job.notify});if(entry.summary?.status!=='ready')throw Error('Summary retry failed');}
  }
  async stop(){clearInterval(this.timer);this.timer=null;await this.running;}
}
