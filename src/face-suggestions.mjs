import { createHash } from 'node:crypto';
import {join} from 'node:path';
import {readJson,writeJson} from './storage.mjs';
import {extractJpeg} from './media.mjs';
export class FaceSuggestions{
  constructor(features){this.features=features;this.file=join(features.service.storage.root,'face-suggestions.json');this.decisions=readJson(this.file,{});this.running=0;}
  candidates(){
    const output=[];
    for(const entry of this.features.service.events){
      const profile=this.features.settings.profile(entry.cameraId);
      if(entry.status!=='ready'||!entry.clip||entry.ai?.status!=='ready'||!entry.video?.width||!entry.video?.height||!profile.monitoring||!profile.faceRecognition)continue;
      // Pick one stable frame per clip, with all visible faces in that frame.
      const samples=(entry.ai.samples||[]).filter(sample=>Number.isSafeInteger(sample.frameIndex)&&Array.isArray(sample.faces));
      const quality=sample=>Math.max(0,...sample.faces.map(face=>{
        if(face.box?.length!==4)return 0;
        const detail=Number.isFinite(face.detail)?Math.min(1,Math.max(0,face.detail)/400):0;
        return face.box[2]*face.box[3]*(1+detail);
      }));
      const best=samples.toSorted((a,b)=>quality(b)-quality(a))[0];
      if(!best)continue;
      for(const [index,face]of best.faces.entries()){
        if(['unconfirmed','needs-reanalysis'].includes(face.identityStatus)||face.name||face.box?.length!==4||face.box.some(value=>!Number.isFinite(value))||face.box[2]<48||face.box[3]<48||face.score<.85)continue;
        const id=createHash('sha256').update(`${entry.id}:${best.frameIndex}:${index}`).digest('hex');
        if(this.decisions[id])continue;
        output.push({id,entry,frameIndex:best.frameIndex,face,index});
      }
    }
    return output;
  }
  list(){const candidates=this.candidates();return {total:candidates.length,items:candidates.slice(0,30).map(({id,entry})=>({id,clipId:entry.id,camera:entry.camera,at:entry.at}))};}
  candidate(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new Error('Gesicht nicht gefunden.');const candidate=this.candidates().find(item=>item.id===id);if(!candidate)throw new Error('Gesicht ist nicht mehr zur Zuordnung verfügbar.');return candidate;}
  async image(candidate){
    if(this.running>=2)throw new Error('Gesichtsbilder werden vorbereitet. Bitte kurz warten.');
    const {entry,face,frameIndex}=candidate, [x,y,w,h]=face.box;
    const width=entry.video?.width,height=entry.video?.height;if(!width||!height)throw new Error('Für diesen alten Clip fehlen Bildmaße. Bitte erneut lokal auswerten oder ein Foto verwenden.');
    const left=Math.max(0,Math.floor(x-w*.5)),top=Math.max(0,Math.floor(y-h*.5));
    const crop=[left,top,Math.min(width-left,Math.ceil(w*2)),Math.min(height-top,Math.ceil(h*2))];
    this.running++;try{return await extractJpeg(this.features.path(entry),{frameIndex,maxWidth:640,crop});}finally{this.running--;}
  }
  dismiss(id){this.candidate(id);this.decisions[id]={status:'ignored',at:new Date().toISOString()};writeJson(this.file,this.decisions);}
  forgetPerson(id){for(const [key,value]of Object.entries(this.decisions))if(value.personId===id)delete this.decisions[key];writeJson(this.file,this.decisions);for(const entry of this.features.service.events)if(entry.peopleAssignments)entry.peopleAssignments=entry.peopleAssignments.filter(person=>person.personId!==id);}
  enroll(id,name){
    if(typeof name!=='string'||!name.trim()||name.length>60)throw new Error('Einen Namen mit höchstens 60 Zeichen angeben.');
    const candidate=this.candidate(id),entry=candidate.entry,key=`ai:${entry.id}`;this.features.assertIdle(entry.id);this.features.jobs.add(key);
    const task=(async()=>{try{
      const bytes=await this.image(candidate),person=await this.features.ai.enroll({name,image:'data:image/jpeg;base64,'+bytes.toString('base64')});
      this.decisions[id]={status:'named',personId:person.id,at:new Date().toISOString()};writeJson(this.file,this.decisions);
      entry.peopleAssignments=[...(entry.peopleAssignments||[]),{personId:person.id,name:person.name,at:new Date().toISOString()}];this.features.save();return person;
    }finally{this.features.jobs.delete(key);}})();return this.features.track(task);
  }
}
