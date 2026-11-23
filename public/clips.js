const clipEl=window.tw.element, archive=document.querySelector('[data-page="/clips"]');
const toolbar=clipEl('div','clips-toolbar'), count=clipEl('p','small-note','Aufnahmen werden geladen …'), cameraFilter=clipEl('select'); cameraFilter.setAttribute('aria-label','Clips nach Kamera filtern'); toolbar.append(count,cameraFilter);
const playerPanel=clipEl('section','clip-player-panel'); playerPanel.hidden=true;
const playerTop=clipEl('div','panel-top'), playerTitle=clipEl('h2'), playerClose=clipEl('button','text-button','Schließen');playerClose.type='button';playerTop.append(playerTitle,playerClose);
const archiveVideo=clipEl('video');archiveVideo.controls=true;archiveVideo.playsInline=true;archiveVideo.preload='metadata';archiveVideo.id='archive-player';playerPanel.append(playerTop,archiveVideo);
const grid=clipEl('div','clip-grid'), footer=clipEl('div','clip-footer'), more=clipEl('button','button','Weitere Clips laden');more.type='button';more.hidden=true;footer.append(more); archive.append(playerPanel,toolbar,grid,footer);
let nextCursor=null,loading=false,lastSignature='',generation=0;
async function openArchiveClip(entry){
  await window.tw.stopLive?.();
  playerTitle.textContent=`${entry.camera||'Aufnahme'} · ${new Date(entry.at).toLocaleString('de-DE')}`;
  archiveVideo.src=`/clips/${entry.clip}`;playerPanel.hidden=false;archiveVideo.play().catch(()=>{});playerPanel.scrollIntoView({behavior:'smooth',block:'start'});
}
playerClose.onclick=()=>{archiveVideo.pause();archiveVideo.removeAttribute('src');archiveVideo.load();playerPanel.hidden=true;};
window.tw.playArchiveClip=openArchiveClip;
archiveVideo.onerror=()=>{count.textContent='Video konnte nicht geladen werden. Bitte erneut anmelden oder den Clip herunterladen.';};
function card(entry){
  const node=clipEl('article','clip-card'), preview=clipEl('button','clip-preview');preview.type='button';preview.setAttribute('aria-label',`Clip von ${entry.camera||'Kamera'} vom ${new Date(entry.at).toLocaleString('de-DE')} abspielen`);
  const image=clipEl('img');image.alt='Vorschaubild der Aufnahme';image.loading='lazy';image.src=`/api/clips/${entry.id}/thumbnail`;
  let retries=0;image.onerror=()=>{if(retries++<3)setTimeout(()=>{image.src=`/api/clips/${entry.id}/thumbnail?attempt=${retries}`;},1200*retries);};
  preview.append(image,clipEl('span','clip-play','▶'),clipEl('span','clip-duration',`${Math.round(entry.video?.durationSeconds||10)} s`));preview.onclick=()=>openArchiveClip(entry);
  const body=clipEl('div','clip-content');body.append(clipEl('h3','',entry.camera||'Kamera'),clipEl('p','',`${new Date(entry.at).toLocaleString('de-DE')} · ${entry.trigger==='ding'?'Klingeln':entry.trigger==='motion'?'Bewegung':'Manuell'}`));
  if(entry.ai?.status==='ready'&&entry.ai.personDetected)body.append(clipEl('p','ai-result',`Person / Gesicht erkannt${entry.ai.names?.length?' · KI-Zuordnung: '+entry.ai.names.join(', '):''}`));
  if(entry.summary?.status==='ready')body.append(clipEl('p','summary-result',entry.summary.text));
  if(entry.video?.quality?.impaired)body.append(clipEl('p','small-note','Video enthält Bildfehler oder Zeitlücken. Fehlende Kameradaten können nicht nachträglich ergänzt werden.'));
  if(entry.summary?.validation?.fallback)body.append(clipEl('p','small-note','KI-Beschreibung war nicht zuverlässig; es wird nur der sicherere Befund angezeigt.'));
  if(entry.summary?.validation?.removedSpeculation)body.append(clipEl('p','small-note','Unsichere Vermutungen der KI wurden weggelassen.'));
  if(entry.summary?.manual)body.append(clipEl('p','small-note','Manuell neu erstellt; nicht erneut an Discord gesendet.'));
  if(entry.ai?.unconfirmedFace)body.append(clipEl('p','small-note','Name noch nicht über mehrere Bilder bestätigt.'));
  if(entry.ai?.faceEngine==='network')body.append(clipEl('p','small-note','Gesichtsmerkmale im Heimnetz berechnet.'));
  if(entry.ai?.faceEngine==='network-arcface')body.append(clipEl('p','small-note','ArcFace im Heimnetz ausgewertet.'));
  if(entry.ai?.faceEngine==='local-fallback'&&!entry.ai.arcFaceFallback)body.append(clipEl('p','small-note','Gesichts-Worker nicht erreichbar. Lokal ausgewertet.'));
  if(entry.ai?.identityGalleryStale)body.append(clipEl('p','small-note','Gesichtsvorlagen geändert; Namen erneut lokal prüfen.'));
  if(entry.ai?.status==='ready'&&!entry.ai.personDetected)body.append(clipEl('p','small-note',`Keine Person / kein Gesicht in ${entry.ai.sampleCount} geprüften Bildern erkannt.`));
  if(entry.ai&&['queued','working'].includes(entry.ai.status))body.append(clipEl('p','small-note','Lokale Personen-/Gesichtsprüfung läuft …'));
  if(entry.ai?.status==='error')body.append(clipEl('p','small-note',entry.ai.message));
  window.tw.appendFaceDiagnostics?.(body,entry);
  if(entry.summary&&['queued','working'].includes(entry.summary.status))body.append(clipEl('p','small-note','KI-Kurzbeschreibung wird erstellt …'));
  if(entry.summary&&['error','skipped'].includes(entry.summary.status))body.append(clipEl('p','small-note',entry.summary.message));
  window.tw.appendDiscordStatus(body,entry);
  const play=clipEl('button','button','Clip ansehen');play.type='button';play.onclick=()=>openArchiveClip(entry);body.append(play);
  if (window.tw.can(entry.cameraId, 'export')) { const download=clipEl('a','text-button','Herunterladen');download.href=`/api/clips/${entry.id}/export`;download.download=entry.clip;body.append(download); }
  const state=window.tw.getState(),profile=state.cameraProfiles?.[entry.cameraId];
  if(entry.peopleAssignments?.length)body.append(clipEl('p','ai-result','Von dir zugeordnet: '+[...new Set(entry.peopleAssignments.map(person=>person.name))].join(', ')));
  if(entry.protected)body.append(clipEl('p','badge','Geschützt vor automatischer Löschung'));
  if(entry.local?.status==='deleted')body.append(clipEl('p','badge','Nur in der Cloud gespeichert'));
  if(window.tw.can(entry.cameraId, 'protect')){
    const protect=clipEl('button','text-button',entry.protected?'Schutz aufheben':'Vor automatischer Löschung schützen');protect.type='button';protect.onclick=async()=>{if(await window.tw.action('/api/clips/protect',{id:entry.id,protected:!entry.protected}))loadArchive();};body.append(protect);
  }
  if(window.tw.can(entry.cameraId, 'review') && entry.summary?.status==='ready'){const review=clipEl('button','text-button','KI-Beschreibung bewerten');review.type='button';review.onclick=()=>window.tw.reviewClip(entry);body.append(review);}
  if(window.tw.can(entry.cameraId, 'analyze')){
    const analyze=clipEl('button','text-button','Personen / Gesichter prüfen');analyze.type='button';analyze.disabled=entry.local?.status==='deleted'||!profile?.monitoring||(!profile.personDetection&&!profile.faceRecognition)||!state.ai?.modelsReady;analyze.title='Lokale Personen-/Gesichtserkennung im Kamera-Profil einschalten';analyze.onclick=()=>window.tw.action('/api/analyze',{id:entry.id});body.append(analyze);
  }
  if(window.tw.can(entry.cameraId,'delete')){const remove=clipEl('button','text-button danger','Clip löschen');remove.type='button';remove.onclick=async()=>{if(confirm('Diesen Clip und eine eventuell vorhandene R2/S3-Kopie löschen?')&&await window.tw.action('/api/delete',{id:entry.id})){playerClose.onclick();loadArchive();}};body.append(remove);}
  node.append(preview,body);return node;
}
async function loadArchive(append=false){
  if(!window.tw.getState()?.user||loading)return;
  loading=true;more.disabled=true;const version=generation;
  try{
    const query=new URLSearchParams({limit:'24',cameraId:cameraFilter.value});if(append&&nextCursor)query.set('cursor',nextCursor);
    const response=await fetch('/api/clips?'+query);const page=await response.json();if(!response.ok)throw new Error(page.error||'Archiv nicht erreichbar.');
    if(version!==generation)return;
    if(!append)grid.replaceChildren();for(const entry of page.items)grid.append(card(entry));
    count.textContent=`${page.total} gespeicherte ${page.total===1?'Aufnahme':'Aufnahmen'}`;nextCursor=page.nextCursor;more.hidden=!nextCursor;
    if(!page.items.length&&!append)grid.append(clipEl('p','small-note','Noch keine Aufnahmen vorhanden. Starte eine kurze Aufnahme in der Übersicht.'));
  }catch(error){count.textContent=error.message;}
  finally{loading=false;more.disabled=false;if(version!==generation&&location.pathname==="/clips")loadArchive();}
}
cameraFilter.onchange=()=>{generation++;loadArchive();};more.onclick=()=>loadArchive(true);
window.addEventListener('tw-route',({detail:path})=>{if(path==='/clips')loadArchive();else playerClose.onclick();});
window.addEventListener('tw-state',({detail:state})=>{
  if(!state.user){playerClose.onclick();grid.replaceChildren();lastSignature='';generation++;return;}
  const signature=JSON.stringify([state.user.id,state.sites,state.permissions,state.clipCount,state.archiveRevision,state.recording,state.events.filter(e=>e.clip).map(e=>[e.id,e.ai,e.summary])]);
  if(signature===lastSignature)return;lastSignature=signature;
  const selected=cameraFilter.value;cameraFilter.replaceChildren();const all=clipEl('option','','Alle Kameras');all.value='';cameraFilter.append(all);
  for(const camera of state.cameras){const option=clipEl('option','',camera.name);option.value=camera.id;cameraFilter.append(option);}cameraFilter.value=selected;
  if(location.pathname==='/clips')loadArchive();
});
if(location.pathname==='/clips')loadArchive();
