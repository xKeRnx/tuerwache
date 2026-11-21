const tel=window.tw.element,timelinePage=document.querySelector('[data-page="/timeline"]'),timelineToolbar=tel('div','timeline-toolbar');
const timelineCamera=tel('select');timelineCamera.setAttribute('aria-label','Zeitstrahl nach Kamera filtern');
const dateLabel=tel('label','','Datum'),timelineDay=tel('input');timelineDay.type='date';timelineDay.setAttribute('aria-label','Datum im Zeitstrahl');dateLabel.append(timelineDay);
const timelineKind=tel('select');timelineKind.setAttribute('aria-label','Ereignisart im Zeitstrahl');for(const [value,label]of[['','Alle Ereignisse'],['clip','Nur Aufnahmen'],['ding','Klingeln'],['motion','Bewegung'],['person','Person / Gesicht']]){const option=tel('option','',label);option.value=value;timelineKind.append(option);}
const allDays=tel('button','button','Alle Tage');allDays.type='button';timelineToolbar.append(timelineCamera,dateLabel,timelineKind,allDays);
const timelineCount=tel('p','small-note'),timelineList=tel('div','timeline-list'),timelineFooter=tel('div','clip-footer'),timelineMore=tel('button','button','Ältere Ereignisse laden');timelineMore.type='button';timelineMore.hidden=true;timelineFooter.append(timelineMore);timelinePage.append(timelineToolbar,timelineCount,timelineList,timelineFooter);
const timelineHelp=tel('p','small-note','Automatische KI-Kurzbeschreibungen wählst du je Kamera unter Kameras → KI & Gesichter. Vorhandene Aufnahmen kannst du hier mit „Szene beschreiben“ nachträglich auswerten.');timelineToolbar.after(timelineHelp);
let timelineCursor=null,timelineBusy=false,timelineRevision=0,timelineSignature='',lastDay='';
function timelineRow(entry){
  const row=tel('article','timeline-row'),time=tel('time','timeline-time',new Date(entry.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}));time.dateTime=entry.at;
  const body=tel('div','timeline-card'),playable=entry.clip&&entry.status==='ready';
  if(playable){const thumbnail=tel('button','timeline-thumb');thumbnail.type='button';thumbnail.setAttribute('aria-label',`Aufnahme von ${entry.camera} abspielen`);const image=tel('img');image.alt='Vorschaubild der Aufnahme';image.loading='lazy';image.src=`/api/clips/${entry.id}/thumbnail`;let retry=0;image.onerror=()=>{if(retry++<3)setTimeout(()=>{image.src=`/api/clips/${entry.id}/thumbnail?retry=${retry}`;},1200*retry);};thumbnail.append(image,tel('span','clip-play','▶'));thumbnail.onclick=()=>{window.tw.navigate('/clips');window.tw.playArchiveClip(entry);};body.append(thumbnail);}
  const details=tel('div','timeline-details'),label=entry.type==='clip'?(entry.trigger==='ding'?'Klingel-Aufnahme':entry.trigger==='motion'?'Bewegungsaufnahme':'Manuelle Aufnahme'):entry.type==='ding'?'Es hat geklingelt':'Bewegung gemeldet';
  details.append(tel('h3','',`${entry.camera||'Kamera'} · ${label}`));
  if(playable)details.append(tel('p','small-note',`${Math.round(entry.video?.durationSeconds||10)} Sekunden · lokal gespeichert`));
  else details.append(tel('p','small-note',entry.type==='clip'?entry.message:entry.recordingDecision?.message||'Keine Aufnahme gespeichert. Der Grund wurde bei diesem älteren Ereignis noch nicht protokolliert.'));
  if(entry.summary?.status==='ready'){details.append(tel('p','timeline-summary',entry.summary.text),tel('span','small-note','KI-Kurzbeschreibung · kann Fehler enthalten'));}
  else if(entry.summary&&['queued','working'].includes(entry.summary.status))details.append(tel('p','small-note','KI-Kurzbeschreibung wird erstellt …'));
  else if(entry.summary&&['error','skipped'].includes(entry.summary.status))details.append(tel('p','small-note',entry.summary.message||'KI-Kurzbeschreibung konnte nicht erstellt werden.'));
  else if(playable)details.append(tel('p','small-note','Noch keine KI-Kurzbeschreibung vorhanden.'));
  const names=[...new Set([...(entry.ai?.names||[]),...(entry.peopleAssignments||[]).map(person=>person.name)])];
  if(names.length)details.append(tel('p','ai-result','Zugeordnet: '+names.join(', ')));
  else if(entry.ai?.status==='ready'&&entry.ai.personDetected)details.append(tel('p','ai-result','Person / Gesicht erkannt'));
  else if(entry.ai?.status==='ready')details.append(tel('p','small-note',`Keine Person / kein Gesicht in ${entry.ai.sampleCount} geprüften Bildern erkannt.`));
  else if(entry.ai&&['queued','working'].includes(entry.ai.status))details.append(tel('p','small-note','Lokale Personen-/Gesichtsprüfung läuft …'));
  else if(entry.ai?.status==='error')details.append(tel('p','small-note',entry.ai.message));
  if(entry.ai?.unconfirmedFace)details.append(tel('p','small-note','Name noch nicht über mehrere Bilder bestätigt.'));
  if(entry.ai?.identityGalleryStale)details.append(tel('p','small-note','Gesichtsvorlagen geändert; Namen erneut lokal prüfen.'));
  if(playable&&entry.requestedSeconds&&entry.video?.durationSeconds<entry.requestedSeconds-1)details.append(tel('p','small-note',entry.message));
  window.tw.appendDiscordStatus(details,entry);
  if(playable){const actions=tel('div','event-actions'),open=tel('button','','Clip ansehen');open.type='button';open.onclick=()=>{window.tw.navigate('/clips');window.tw.playArchiveClip(entry);};actions.append(open);
    const state=window.tw.getState(),profile=state.cameraProfiles?.[entry.cameraId];if(window.tw.can(entry.cameraId, 'analyze')){const summary=tel('button','','Szene beschreiben');summary.disabled=!profile?.monitoring||(!profile.summaryProvider||profile.summaryProvider==='off')||['queued','working'].includes(entry.summary?.status);summary.title='KI-Anbieter zuerst im Kamera-Profil auswählen';summary.onclick=()=>window.tw.action('/api/summarize',{id:entry.id});actions.append(summary);}details.append(actions);}
  body.append(details);row.append(time,body);return row;
}
async function loadTimeline(append=false){
  if(!window.tw.getState()?.user||timelineBusy)return;timelineBusy=true;timelineMore.disabled=true;const revision=timelineRevision;
  try{const query=new URLSearchParams({limit:'48',cameraId:timelineCamera.value,kind:timelineKind.value});if(append&&timelineCursor)query.set('cursor',timelineCursor);
    if(timelineDay.value){const from=new Date(timelineDay.value+'T00:00:00'),to=new Date(from);to.setDate(to.getDate()+1);query.set('from',from.toISOString());query.set('to',to.toISOString());}
    const response=await fetch('/api/timeline?'+query),page=await response.json();if(!response.ok)throw new Error(page.error||'Zeitstrahl nicht erreichbar.');if(revision!==timelineRevision)return;
    if(!append){timelineList.replaceChildren();lastDay='';}
    for(const entry of page.items){const day=new Date(entry.at).toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});if(day!==lastDay){timelineList.append(tel('h2','timeline-day',day));lastDay=day;}timelineList.append(timelineRow(entry));}
    timelineCount.textContent=`${page.total} Ereignisse im ausgewählten Zeitraum`;timelineCursor=page.nextCursor;timelineMore.hidden=!timelineCursor;
    if(!page.items.length&&!append)timelineList.append(tel('p','small-note','Für diese Auswahl gibt es noch keine Ereignisse.'));
  }catch(error){timelineCount.textContent=error.message;}finally{timelineBusy=false;timelineMore.disabled=false;if(revision!==timelineRevision&&location.pathname==='/timeline')loadTimeline();}
}
function changeTimeline(){timelineRevision++;loadTimeline();}timelineCamera.onchange=changeTimeline;timelineDay.onchange=changeTimeline;timelineKind.onchange=changeTimeline;allDays.onclick=()=>{timelineDay.value='';changeTimeline();};timelineMore.onclick=()=>loadTimeline(true);
window.addEventListener('tw-route',({detail:path})=>{if(path==='/timeline')loadTimeline();});
window.addEventListener('tw-state',({detail:state})=>{
  if(!state.user){timelineList.replaceChildren();timelineSignature='';timelineRevision++;return;}
  const signature=JSON.stringify([state.events,state.archiveRevision,state.cameraProfiles,state.permissions,state.sites]);if(signature===timelineSignature)return;timelineSignature=signature;
  const selected=timelineCamera.value;timelineCamera.replaceChildren();const all=tel('option','','Alle Kameras');all.value='';timelineCamera.append(all);for(const camera of state.cameras){const option=tel('option','',camera.name);option.value=camera.id;timelineCamera.append(option);}timelineCamera.value=selected;
  if(location.pathname==='/timeline')loadTimeline();
});
if(location.pathname==='/timeline')loadTimeline();
if(window.tw.getState())window.dispatchEvent(new CustomEvent('tw-state',{detail:window.tw.getState()}));
