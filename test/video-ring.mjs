// Explicit hardware check; stop the normal server first. Never runs in npm test.
// Uses the existing account/profile unchanged; deliberately no notification jobs.
import {RingApi} from 'ring-client-api';
import ffmpegPath from 'ffmpeg-for-homebridge';
import {join,resolve} from 'node:path';
import {RingService} from '../src/ring-service.mjs';
import {Settings} from '../src/settings.mjs';
import {LiveVideo} from '../src/live.mjs';
import {inspectVideoQuality} from '../src/video-quality.mjs';
import {readJson,writeJson,prepareStorage} from '../src/storage.mjs';
const [directory,cameraId]=process.argv.slice(2);
if(!directory||!cameraId)throw Error('Specify existing data directory and camera ID');
const storage=prepareStorage(resolve(directory)),saved=readJson(storage.session,null);
if(!saved?.refreshToken)throw Error('Existing Ring session required');
const api=new RingApi({refreshToken:saved.refreshToken,ffmpegPath,avoidSnapshotBatteryDrain:true,controlCenterDisplayName:'Türwache Video-Prüfung'});
const subscription=api.onRefreshTokenUpdated.subscribe(({newRefreshToken})=>writeJson(storage.session,{refreshToken:newRefreshToken}));
const service=new RingService(storage);let live;
try{
  service.cameras=await api.getCameras();service.phase='connected';
  service.features={settings:new Settings(storage),ready(){}};
  const capture=service.capture(cameraId);capture.catch(()=>{});
  for(let attempt=0;attempt<500&&!service.recordings.get(cameraId)?.session;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  if(!service.recordings.get(cameraId)?.session)throw Error('No shared camera session');
  live=new LiveVideo(service,()=>true);
  const state=await live.start({id:'local-video-check'},cameraId),job=live.job;
  const overlap=service.mediaHub.state();
  if(!overlap.active.some(group=>group.cameraId===cameraId&&group.outputs.includes('live')&&group.outputs.includes('recording')))throw Error('Live and recording did not overlap');
  const playlist=await live.asset(job.id,'index.m3u8',job.ticket),segment=/segment\d{5}\.ts/.exec(playlist.body)?.[0];
  if(!segment)throw Error('No HLS segment');
  const liveQuality=await inspectVideoQuality(join(job.directory,segment));
  await capture;const entry=service.events.find(item=>item.cameraId===cameraId&&item.type==='clip');
  const liveAfterRecording=service.mediaHub.state();
  if(!liveAfterRecording.active.some(group=>group.cameraId===cameraId&&group.outputs.includes('live')&&!group.outputs.includes('recording')))throw Error('Live connection did not survive recording');
  const report={at:new Date().toISOString(),cameraId,clipId:entry.id,video:entry.video,overlap,liveAfterRecording,liveAudio:state.hasAudio,liveMode:state.videoMode,liveVideo:state.video,liveQuality,note:'Actual simultaneous camera test, no Discord/push/cloud analysis jobs; no subjective phone playback test.'};
  writeJson(join(storage.root,'video-reliability-test.json'),report);console.log(JSON.stringify(report,null,2));
}finally{await live?.stop();service.close();subscription.unsubscribe();api.disconnect();}
process.exit(0);
