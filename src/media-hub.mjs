import {randomUUID} from 'node:crypto';
import {ReplaySubject,Subject} from 'rxjs';
import {StreamingSession} from 'ring-client-api/streaming/streaming-session';
import {configureVideoRecovery, VideoPacketBuffer} from './video-transport.mjs';
import {H264Recovery} from './h264-recovery.mjs';

// One Ring call per camera; each output owns an independently stoppable lease.
// FFmpeg ending an MP4 must not close the camera call used by a live viewer.
export class MediaHub {
  constructor({limit=4,branchFactory}={}){this.limit=limit;this.entries=new Map();this.branchFactory=branchFactory;}
  async acquire(camera,purpose){
    const cameraId=String(camera.id);let group=this.entries.get(cameraId);
    if(!group){
      if(this.entries.size>=this.limit)throw Error('Maximale Anzahl gleichzeitiger Kameraverbindungen erreicht.');
      group={cameraId,leases:new Map(),closed:false,root:null};this.entries.set(cameraId,group);
      group.opening=Promise.resolve().then(()=>camera.startLiveCall()).then(root=>{
        group.root=root;
        if(group.closed){root.stop();throw Error('Kameraverbindung beendet.');}
        if (root.connection) {
          group.recovery = configureVideoRecovery(root);
          group.video = new Subject();
          let lastRequest = -Infinity;
          let lastOutput = performance.now();
          let keyFrameRequests = 0;
          const requestKeyFrame = (force = false) => {
            const now = performance.now();
            if (!force && now - lastRequest < 1000) return;
            lastRequest = now;
            keyFrameRequests++;
            root.requestKeyFrame?.();
          };
          group.requestKeyFrame = requestKeyFrame;
          let h264 = false;
          const forward = (packet, picture = true) => {
            if (picture) lastOutput = performance.now();
            group.video.next(packet);
          };
          const video = new H264Recovery(forward, requestKeyFrame);
          group.codecSubscription = root.connection.onCallAnswered?.subscribe(sdp => {
            h264 = typeof sdp === 'string' && /^a=rtpmap:\d+ H264\/90000/mi.test(sdp);
          });
          group.buffer = new VideoPacketBuffer(
            packet => h264 ? video.push(packet) : forward(packet),
            () => h264 ? video.gap() : requestKeyFrame(),
          );
          group.recoveryMetrics = () => ({ ...group.buffer.metrics, discardedPictures: video.discardedPictures, keyFrameRequests });
          group.watchdog = setInterval(() => {
            if (group.leases.size && performance.now() - lastOutput >= 1200 && group.buffer.pending.size === 0) requestKeyFrame();
          }, 300);
          group.watchdog.unref();
          group.videoSubscription = root.onVideoRtp.subscribe(packet => group.buffer.push(packet));
        }
        group.ended=root.onCallEnded.subscribe(()=>this.finish(group));return root;
      }).catch(error=>{this.finish(group);throw error;});
    }
    const root=await group.opening;
    if(group.closed)throw Error('Kameraverbindung beendet.');
    const id=randomUUID(),ended=new ReplaySubject(1);
    const release=()=>{
      if(!group.leases.delete(id))return;
      ended.next();ended.complete();
      if(!group.leases.size)this.finish(group);
    };
    const original=root.connection;
    let branch;
    if(original){
      const initial = group.recoveryMetrics();
      const recoveryMetrics = () => Object.fromEntries(Object.entries(group.recoveryMetrics()).map(([key, count]) => [key, count - initial[key]]));
      const connection={onVideoRtp:group.video,rawVideoRtp:root.onVideoRtp,videoRecovery:group.recovery,recoveryMetrics,onAudioRtp:root.onAudioRtp,onCallAnswered:original.onCallAnswered,onCallEnded:ended,onError:original.onError,
        requestKeyFrame:()=>group.requestKeyFrame(true),activateCameraSpeaker:()=>root.activateCameraSpeaker?.(),sendAudioPacket:packet=>root.sendAudioPacket(packet),stop:release};
      branch=this.branchFactory?this.branchFactory(camera,connection):new StreamingSession(camera,connection);
    }else{
      // Lightweight test/adaptor sessions without a connection object.
      branch=Object.assign(Object.create(Object.getPrototypeOf(root)),root,{onCallEnded:ended,stop:release});
    }
    group.leases.set(id,{id,purpose,ended,branch,release});
    return branch;
  }
  finish(group){
    if(group.closed)return;group.closed=true;
    if(this.entries.get(group.cameraId)===group)this.entries.delete(group.cameraId);
    group.ended?.unsubscribe();
    clearInterval(group.watchdog);
    group.videoSubscription?.unsubscribe();
    group.codecSubscription?.unsubscribe();
    group.buffer?.close();
    group.video?.complete();
    for(const lease of [...group.leases.values()]){group.leases.delete(lease.id);lease.ended.next();lease.ended.complete();lease.branch.stop();}
    group.root?.stop();
  }
  closeCamera(cameraId){const group=this.entries.get(String(cameraId));if(group)this.finish(group);}
  closeAll(){for(const group of [...this.entries.values()])this.finish(group);}
  state(){return {limit:this.limit,active:[...this.entries.values()].map(group=>({cameraId:group.cameraId,outputs:[...group.leases.values()].map(lease=>lease.purpose),opening:!group.root}))};}
}
