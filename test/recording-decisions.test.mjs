import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RingService} from '../src/ring-service.mjs';
import {prepareStorage} from '../src/storage.mjs';
import {cleanTestDirectory} from './helpers.mjs';
test('Bewegungsereignisse speichern den konkreten Grund für ausgelassene, fehlgeschlagene und erfolgreiche Aufnahmen',async t=>{
  const root=await mkdtemp(join(tmpdir(),'tuerwache-decisions-'));t.after(()=>cleanTestDirectory(root));const service=new RingService(prepareStorage(root)),camera={id:1,name:'Testkamera'};let profile={monitoring:true,recordMotion:false};
  service.features={settings:{profile:()=>profile}};const latest=()=>service.events.find(event=>event.type==='motion').recordingDecision;
  service.onCameraEvent(camera,'motion');assert.equal(latest().reason,'trigger-disabled');
  profile.recordMotion=true;service.recording={cameraId:'1'};service.onCameraEvent(camera,'motion');assert.equal(latest().reason,'recording-finishing');service.recording=null;
  let called=0;service.capture=async()=>{called++;};service.live={job:{cameraId:'1'}};service.recordings.set('2',{});service.onCameraEvent(camera,'motion');assert.equal(latest().reason,'capture-requested');assert.equal(called,1);service.live=null;service.recordings.clear();service.lastAutomatic.clear();
  service.lastAutomatic.set('1',Date.now());service.onCameraEvent(camera,'motion');assert.equal(latest().reason,'cooldown');service.lastAutomatic.clear();
  service.capture=async()=>{throw new Error('Testfehler bei der Aufnahme.');};service.onCameraEvent(camera,'motion');await new Promise(resolve=>setImmediate(resolve));assert.equal(latest().reason,'capture-failed');assert.match(latest().message,/Testfehler/);
  service.lastAutomatic.clear();service.capture=async(_id,_type,context)=>{service.event('clip',camera,'Testclip gespeichert.',{status:'ready',clip:'fixture.mp4',sourceEventId:context.sourceEventId});};service.onCameraEvent(camera,'motion');await new Promise(resolve=>setImmediate(resolve));assert.equal(latest().status,'recorded');assert.ok(latest().clipId);
  const restarted=new RingService(prepareStorage(root));assert.ok(restarted.events.some(event=>event.recordingDecision?.reason==='trigger-disabled'));
});
