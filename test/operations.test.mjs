import {observeRingTransport} from '../src/ring-health.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReplaySubject,Subject} from 'rxjs';
import {MediaHub} from '../src/media-hub.mjs';
import {OperationsConfig} from '../src/operations-config.mjs';
import {RetryQueue} from '../src/retry-queue.mjs';
import {Retention} from '../src/retention.mjs';
import {AIQuality} from '../src/ai-quality.mjs';
import {attachVisit,visitPage} from '../src/visits.mjs';
import {createBackupArchive,verifyBackupArchive,verifyStaging} from '../src/backup-archive.mjs';
import {restoreVerified} from '../scripts/restore.mjs';
import {cleanTestDirectory} from './helpers.mjs';
const uuid='11111111-1111-4111-8111-111111111111';
async function temp(t){const root=await mkdtemp(join(tmpdir(),'tuerwache-ops-'));t.after(()=>cleanTestDirectory(root));return root;}

test('Shared media: simultaneous leases open once, stop independently and enforce camera capacity',async()=>{
  let starts=0,stops=0;const ended=new ReplaySubject(1),root={onCallEnded:ended,connection:{onCallAnswered:new ReplaySubject(1),onError:new Subject()},onAudioRtp:new Subject(),onVideoRtp:new Subject(),stop(){stops++;ended.next();}};
  const hub=new MediaHub({limit:1,branchFactory:(_camera,connection)=>({connection,stop:()=>connection.stop()})}),camera={id:1,startLiveCall:async()=>{starts++;return root;}};
  const [recording,live]=await Promise.all([hub.acquire(camera,'recording'),hub.acquire(camera,'live')]);assert.equal(starts,1);assert.equal(hub.state().active[0].outputs.length,2);
  const recordingPackets=[],livePackets=[];
  recording.connection.onVideoRtp.subscribe(packet=>recordingPackets.push(packet.header.sequenceNumber));
  live.connection.onVideoRtp.subscribe(packet=>livePackets.push(packet.header.sequenceNumber));
  for(const sequenceNumber of [1,3,2])root.onVideoRtp.next({header:{sequenceNumber}});
  assert.deepEqual(recordingPackets,[1,2,3]);assert.deepEqual(livePackets,[1,2,3]);
  await assert.rejects(hub.acquire({id:2,startLiveCall:camera.startLiveCall},'recording'),/Maximale/);
  recording.stop();assert.equal(stops,0);assert.equal(hub.state().active[0].outputs[0],'live');live.stop();assert.equal(stops,1);assert.equal(hub.entries.size,0);
  const waiting=new MediaHub();let answer;const acquisition=waiting.acquire({id:3,startLiveCall:()=>new Promise(resolve=>answer=resolve)},'live');await new Promise(resolve=>setImmediate(resolve));waiting.closeAll();answer(root);await assert.rejects(acquisition,/beendet/);assert.equal(waiting.entries.size,0);
});

test('Visits group same-camera motion and ding while rejecting stale/future events',()=>{
  const now=Date.now(),events=[{id:'motion',cameraId:'door',visitId:uuid,type:'motion',at:new Date(now-5000).toISOString()}];assert.equal(attachVisit(events,'door',{now}),uuid);assert.notEqual(attachVisit(events,'other',{now}),uuid);assert.notEqual(attachVisit(events,'door',{now:now-10000}),uuid);
  events.push({id:'ding',cameraId:'door',visitId:uuid,type:'ding',at:new Date(now).toISOString()},{id:'clip',cameraId:'door',visitId:uuid,type:'clip',status:'ready',clip:'video',at:new Date(now).toISOString()});const visits=visitPage(events);assert.deepEqual(visits[0].triggers,['motion','ding']);assert.deepEqual(visits[0].clips,['clip']);
});

test('Operations settings keep scheduling off by default and seal secrets; retries survive restart and stop at limit',async t=>{
  const root=await temp(t),config=new OperationsConfig(root);assert.equal(config.public().backups.enabled,false);assert.equal(config.public().retention.local.enabled,false);
  const passphrase='a long synthetic backup phrase';config.update({backups:{passphrase,enabled:true}});assert.equal(config.passphrase(),passphrase);assert.ok(!JSON.stringify(config.public()).includes('sealedPassphrase'));assert.ok(!(await readFile(config.file,'utf8')).includes(passphrase));assert.throws(()=>config.update({recording:{maxCameras:99}}));
  let attempts=0;const queue=new RetryQueue(root,config,async()=>{attempts++;throw Error('private network detail');});queue.enqueue('upload',uuid);queue.enqueue('upload',uuid);queue.enqueue('discord',uuid);assert.equal(queue.jobs.length,1);await queue.run(Date.now()+100000);assert.equal(attempts,1);
  const restarted=new RetryQueue(root,config,queue.handler);await restarted.run(Date.now()+9999999);await restarted.run(Date.now()+19999999);assert.equal(restarted.jobs[0].status,'failed');assert.equal(attempts,3);await restarted.run(Infinity);assert.equal(attempts,3);assert.ok(!(await readFile(restarted.file,'utf8')).includes('private network detail'));
});

test('Retention respects protection, pins, independent cloud rules and cloud-only expiration',async t=>{
  const root=await temp(t),config=new OperationsConfig(root),directory=join(root,'clips');await mkdir(directory);
  const entry={id:uuid,type:'clip',at:'2020-01-01T00:00:00.000Z',status:'ready',clip:uuid+'.mp4',directory,protected:true};await writeFile(join(directory,entry.clip),'video');const entries=[entry];let cloudDeletes=0;
  const features={service:{events:entries,storage:{root,clips:directory}},settings:{value:{cloud:{}}},jobs:new Set(),path:e=>join(directory,e.clip),entry:id=>entries.find(e=>e.id===id),assertIdle(id){if(this.jobs.has('ai:'+id))throw Error('busy');},save(){},cloud:{remove:async()=>{cloudDeletes++;}}};
  const retention=new Retention(features,config);config.update({retention:{local:{enabled:true,days:1,maxGiB:1},cloud:{enabled:false,days:1}}});assert.equal((await retention.preview()).local.length,0);entry.protected=false;features.jobs.add('ai:'+uuid);assert.equal((await retention.run()).errors,1);assert.ok((await stat(join(directory,entry.clip))).isFile());features.jobs.clear();await retention.run();assert.equal(entry.status,'expired');assert.equal(cloudDeletes,0);
  entry.status='ready';entry.cloud={status:'uploaded'};config.update({retention:{cloud:{enabled:true,days:1}}});await retention.run();assert.equal(cloudDeletes,1);assert.equal(entry.status,'expired');assert.equal(entry.cloud.status,'deleted');
});

test('Encrypted backups round-trip; wrong keys/tampering fail; restore migrates paths and refuses a running server',async t=>{
  const root=await temp(t),archive=join(root,'test.twbackup'),pass='synthetic-backup-passphrase',records=[{name:'data/settings.json',bytes:Buffer.from(JSON.stringify({clipsDirectory:'H:\\secret'}))},{name:'data/events.json',bytes:Buffer.from(JSON.stringify([{clip:uuid+'.mp4',directory:'H:\\secret'}]))},{name:'data/auth-encryption.key',bytes:Buffer.alloc(32,1)},{name:'data/clips/'+uuid+'.mp4',bytes:Buffer.from('a private video')}];
  await createBackupArchive(archive,pass,records,{description:'Türwache · äöü 日本語'});const raw=await readFile(archive);assert.ok(!raw.includes(Buffer.from('a private video')));
  await assert.rejects(verifyBackupArchive(archive,'wrong but long enough passphrase',join(root,'wrong')));await assert.rejects(readFile(join(root,'wrong','verification.json')));
  const corrupt=Buffer.from(raw);corrupt[corrupt.length-1]^=1;const corruptPath=join(root,'corrupt');await writeFile(corruptPath,corrupt);await assert.rejects(verifyBackupArchive(corruptPath,pass,join(root,'corrupt-stage')));
  await assert.rejects(createBackupArchive(join(root,'bad.twbackup'),pass,[{name:'data/../../escape',bytes:Buffer.from('bad')}]),/Sicherungspfad/);
  await assert.rejects(verifyBackupArchive(archive,pass,join(root,'too-big'),{maxBytes:3}));
  const staging=join(root,'staging');const proof=await verifyBackupArchive(archive,pass,staging);assert.equal(proof.files.length,4);assert.equal(proof.metadata.description,'Türwache · äöü 日本語');await verifyStaging(staging);
  await writeFile(join(staging,'data','extra.json'),'{}');await assert.rejects(verifyStaging(staging),/Zusätzliche/);
  const clean=join(root,'clean');await verifyBackupArchive(archive,pass,clean);const dataRoot=join(root,'data');await mkdir(dataRoot);await writeFile(join(dataRoot,'old.json'),'old');
  await assert.rejects(restoreVerified({projectRoot:root,staging:clean,dataRoot,apply:true,serverRunning:async()=>true}),/stoppen/);assert.equal(await readFile(join(dataRoot,'old.json'),'utf8'),'old');
  const result=await restoreVerified({projectRoot:root,staging:clean,dataRoot,apply:true,serverRunning:async()=>false});assert.equal(result.reloginRequired,true);assert.equal(JSON.parse(await readFile(join(dataRoot,'settings.json'),'utf8')).clipsDirectory,join(dataRoot,'clips'));assert.equal(await readFile(join(result.previousData,'old.json'),'utf8'),'old');await assert.rejects(readFile(join(dataRoot,'mobile-sessions.json')));
});

test('AI reviews are revision-specific, retain corrections and never alter descriptions',async t=>{
  const root=await temp(t),entry={id:uuid,summary:{status:'ready',model:'synthetic',configurationId:'local',text:'wrong text',at:'2026-01-01'}};const quality=new AIQuality({service:{storage:{root}},entry:()=>entry});quality.review({id:uuid,rating:'incorrect',correction:'A person walks to the door.'},{id:'user'});quality.review({id:uuid,rating:'correct'},{id:'user'});assert.equal(quality.value.reviews.length,1);assert.equal(entry.summary.text,'wrong text');entry.summary.at='2026-01-02';quality.review({id:uuid,rating:'incorrect',correction:'Corrected reference'},{id:'user'});assert.equal(quality.value.reviews.length,2);assert.throws(()=>quality.review({id:uuid,rating:'invalid'},{id:'user'}));
});

test('Model comparisons reuse the same frames, require cloud opt-in and preserve original results',async t=>{
  const root=await temp(t),entry={id:uuid,cameraId:'door',status:'ready',clip:uuid+'.mp4',video:{durationSeconds:20},summary:{status:'ready',text:'Original description'}},calls=[],tasks=[];
  const configs={local:{enabled:true,provider:'ollama',model:'local-vision',baseUrl:'http://127.0.0.1:11434'},cloud:{enabled:true,provider:'openai',model:'cloud-vision',apiKey:'synthetic-secret'}};
  let reserved=0;const features={service:{storage:{root}},entry:()=>entry,settings:{profile:()=>({monitoring:true}),resolveSummary:id=>configs[id]},jobs:new Set(),assertIdle(){},path:()=>'/synthetic',ai:{people:[]},summaries:{reserveCloud(){reserved++;}},track:task=>{tasks.push(task);return task;}};
  const quality=new AIQuality(features,{providers:{summarize:async(provider,_config,frames)=>{calls.push({provider,frames});return {text:'Eine Person geht zur Tür.',elapsedMs:42};}},extract:async()=>Buffer.from('synthetic-frame')});
  assert.throws(()=>quality.compare({clipIds:[uuid],modelIds:['local','cloud']}),/ausdrücklich/);quality.compare({clipIds:[uuid],modelIds:['local','cloud'],allowCloud:true});await Promise.all(tasks);
  assert.equal(quality.value.comparisons[0].status,'ready');assert.equal(calls.length,2);assert.equal(calls[0].frames,calls[1].frames);assert.equal(reserved,1);assert.equal(entry.summary.text,'Original description');assert.equal(features.jobs.size,0);assert.ok(!JSON.stringify(quality.state()).includes('synthetic-secret'));
  const result=quality.value.comparisons[0].results[1];quality.review({resultId:result.id,rating:'incorrect',correction:'Reference correction'},{id:'user'});assert.equal(quality.value.reviews[0].model,'cloud-vision');assert.equal(quality.value.reviews[0].resultId,result.id);
});

test('Ring health captures only fixed transport failures and never persists secret error bodies',()=>{
 const service={};assert.equal(observeRingTransport(service,'private OAuth body'),false);assert.equal(service.pushTransport,undefined);assert.equal(observeRingTransport(service,'Failed to connect push notification receiver'),true);assert.equal(service.pushTransport.status,'error');assert.ok(!JSON.stringify(service).includes('OAuth'));service.closed=true;assert.equal(observeRingTransport(service,'Failed to connect push notification receiver'),false);
});

test('Cloud quota expires oldest unprotected copies independently of local storage',async t=>{
 const root=await temp(t),config=new OperationsConfig(root);config.update({retention:{cloud:{enabled:true,days:3650,maxGiB:1}}});
 const entries=[{id:'old',at:'2026-01-01',status:'ready',clip:'old.mp4',local:{status:'deleted'},bytes:1024**3,cloud:{status:'uploaded'}},{id:'protected',at:'2026-02-01',status:'ready',clip:'protected.mp4',local:{status:'deleted'},protected:true,bytes:2*1024**3,cloud:{status:'uploaded'}}];
 const retention=new Retention({service:{events:entries},path:()=>{throw Error('No local files');}},config);const preview=await retention.preview(Date.parse('2026-03-01'));assert.deepEqual(preview.cloud.map(item=>item.id),['old']);assert.equal(preview.local.length,0);assert.equal(preview.cloudQuotaBlocked,true);assert.equal(preview.protectedCloudBytes,2*1024**3);
});
