import {randomUUID} from 'node:crypto';

export function attachVisit(events,cameraId,{now=Date.now(),gapSeconds=60}={}){
  const previous=events.find(event=>event.cameraId===cameraId&&event.visitId&&['motion','ding','clip'].includes(event.type));
  return previous&&now>=Date.parse(previous.at)&&now-Date.parse(previous.at)<gapSeconds*1000?previous.visitId:randomUUID();
}
export function visitPage(events,{cameraId='',limit=50}={}){
  const groups=new Map();
  for(const event of events){
    if(!event.visitId||(cameraId&&event.cameraId!==cameraId))continue;
    let group=groups.get(event.visitId);
    if(!group){group={id:event.visitId,cameraId:event.cameraId,camera:event.camera,startedAt:event.at,endedAt:event.at,triggers:[],clips:[],eventIds:[]};groups.set(event.visitId,group);}
    group.startedAt=event.at<group.startedAt?event.at:group.startedAt;group.endedAt=event.at>group.endedAt?event.at:group.endedAt;
    group.eventIds.push(event.id);if(['ding','motion'].includes(event.type)&&!group.triggers.includes(event.type))group.triggers.push(event.type);
    if(event.clip&&event.status==='ready')group.clips.push(event.id);
  }
  return [...groups.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,Math.max(1,Math.min(limit,100)));
}
