import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readJson,writeJson} from './storage.mjs';
import {SummaryProviders} from './summary-providers.mjs';
import {extractJpeg} from './media.mjs';
import {summaryPositions,summaryFrameIndex} from './scene-sampling.mjs';
import {scenePrompt,validateSceneDescription} from './scene-description.mjs';
import {anonymousSceneText} from './identity-summary.mjs';
import {isLocalProvider} from './provider-catalog.mjs';
export class AIQuality{
  constructor(features,{providers=new SummaryProviders(),extract=extractJpeg}={}){this.features=features;this.providers=providers;this.extract=extract;this.file=join(features.service.storage.root,'ai-quality.json');this.value={reviews:[],comparisons:[],...readJson(this.file,{})};for(const batch of this.value.comparisons)if(batch.status==='working')batch.status='interrupted';this.running=false;}
  save(){writeJson(this.file,this.value);}
  revision(summary){return createHash('sha256').update(JSON.stringify([summary.at,summary.model,summary.configurationId,summary.sceneText||summary.text])).digest('hex');}
  review(input,user){
    if(!['correct','incorrect','uncertain'].includes(input.rating)||typeof(input.correction??'')!=='string'||(input.correction||'').length>1500)throw Error('Bewertung oder Korrektur ungültig.');
    const result=input.resultId?this.value.comparisons.flatMap(batch=>batch.results.map(result=>({...result,at:batch.at}))).find(result=>result.id===input.resultId):null;
    if(input.resultId&&!result)throw Error('Vergleichsergebnis nicht gefunden.');
    const entry=this.features.entry(result?.eventId||input.id),summary=result||entry.summary;if(summary?.status!=='ready')throw Error('Fertige Beschreibung erforderlich.');
    const revision=this.revision(summary),existing=this.value.reviews.find(review=>review.eventId===entry.id&&review.revision===revision&&review.userId===user.id);
    const review={id:existing?.id||randomUUID(),eventId:entry.id,revision,configurationId:summary.configurationId||summary.provider,model:summary.model,...(result?{resultId:result.id}:{}),rating:input.rating,correction:(input.correction||'').trim(),userId:user.id,at:new Date().toISOString()};
    this.value.reviews=this.value.reviews.filter(item=>item.id!==review.id).slice(-4999);this.value.reviews.push(review);this.save();return review;
  }
  state(){const counts={};for(const review of this.value.reviews){const key=review.configurationId+' · '+review.model;counts[key]??={correct:0,incorrect:0,uncertain:0};counts[key][review.rating]++;}return {running:this.running,counts,reviews:this.value.reviews.slice(-50).toReversed(),comparisons:this.value.comparisons.slice(-10).toReversed()};}
  compare({clipIds,modelIds,allowCloud=false}){
    if(this.running)throw Error('Ein Modellvergleich läuft bereits.');
    if(!Array.isArray(clipIds)||clipIds.length<1||clipIds.length>10||!Array.isArray(modelIds)||modelIds.length<1||modelIds.length>5)throw Error('Ein bis zehn Clips und ein bis fünf Modelle auswählen.');
    clipIds=[...new Set(clipIds)];modelIds=[...new Set(modelIds)];
    const entries=clipIds.map(id=>this.features.entry(id));
    if(entries.some(entry=>entry.local?.status==='deleted'||!this.features.settings.profile(entry.cameraId).monitoring))throw Error('Für Vergleiche lokale Clips einer überwachten Kamera auswählen.');
    const configs=modelIds.map(id=>({id,...this.features.settings.resolveSummary(id)}));
    if(configs.some(config=>!config.enabled||!config.model))throw Error('Alle Vergleichsmodelle zuerst einrichten.');
    if(configs.some(config=>!isLocalProvider(config.provider))&&allowCloud!==true)throw Error('Bildübertragung an ausgewählte Cloud-Modelle ausdrücklich freigeben.');
    for(const entry of entries)this.features.assertIdle(entry.id);
    for(const entry of entries)this.features.jobs.add('comparison:'+entry.id);
    const batch={id:randomUUID(),at:new Date().toISOString(),status:'working',results:[]};this.running=true;this.value.comparisons=this.value.comparisons.slice(-19);this.value.comparisons.push(batch);this.save();
    const task=(async()=>{
      const providers=this.providers;
      for(const entry of entries){
        const masks=this.features.settings.profile(entry.cameraId).privacyZones;
        const frames=[];for(const seconds of summaryPositions(entry,6))frames.push({seconds,bytes:await this.extract(this.features.path(entry),{frameIndex:summaryFrameIndex(entry,seconds),atSeconds:seconds,maxWidth:640,privacyZones:masks})});
        for(const config of configs){const result={id:randomUUID(),eventId:entry.id,configurationId:config.id,model:config.model,provider:config.provider};
          try{const current=this.features.settings.resolveSummary(config.id);if(!this.features.settings.profile(entry.cameraId).monitoring||!current?.enabled||current.model!==config.model||current.apiKey!==config.apiKey||current.baseUrl!==config.baseUrl||current.provider!==config.provider)throw Error('Auswertung geändert.');if(this.features.closed)throw Error('Server wird beendet.');if(!isLocalProvider(config.provider))this.features.summaries.reserveCloud();
            const description=await providers.summarize(config.provider,config,frames,scenePrompt(frames,this.features.settings.profile(entry.cameraId).sceneContext,{storyboard:config.provider==='ollama'}));
            const validated=validateSceneDescription(anonymousSceneText(description.text,this.features.ai.people),entry);
            Object.assign(result,{status:'ready',text:validated.text,elapsedMs:description.elapsedMs,usage:description.usage,fallback:validated.fallback});
          }catch{Object.assign(result,{status:'error',message:'Vergleich fehlgeschlagen. Anbieter, Tageslimit und Clip prüfen.'});}
          batch.results.push(result);this.save();
        }
      }
      batch.status='ready';
    })().catch(()=>{batch.status='error';}).finally(()=>{for(const entry of entries)this.features.jobs.delete('comparison:'+entry.id);this.running=false;this.save();});
    this.features.track(task);return {id:batch.id};
  }
}
