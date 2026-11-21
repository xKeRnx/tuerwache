const fel=window.tw.element,facesPage=document.querySelector('[data-page="/faces"]');
const faceSection=fel('section','unknown-faces'), faceHeading=fel('header','face-section-heading');
faceHeading.append(fel('h2','','Unbekannte Gesichter zuordnen'),fel('p','','Vergib einen Namen oder überspringe das Bild. Bei einem vorhandenen Namen wird eine weitere Gesichtsvorlage hinzugefügt.'));
faceSection.append(faceHeading);
const faceGrid=fel('div','unknown-face-grid');faceSection.append(faceGrid);facesPage.prepend(faceSection);
const prompt=fel('aside','face-prompt');prompt.hidden=true;prompt.setAttribute('role','status');const promptText=fel('span'),openFaces=fel('a','button','Namen zuordnen'),later=fel('button','text-button','Später');openFaces.href='/faces';later.type='button';prompt.append(promptText,openFaces,later);document.querySelector('.heading').after(prompt);
let signature='',snoozed='';later.onclick=()=>{snoozed=signature;prompt.hidden=true;};
window.addEventListener('tw-state',({detail:state})=>{
  if(state.user?.role!=='admin'){prompt.hidden=true;faceGrid.replaceChildren();signature='';return;}
  const candidates = state.faceSuggestions?.items || [];
  const next=JSON.stringify(candidates);const count=state.faceSuggestions?.total||0;
  promptText.textContent=count===1?'Ein unbekanntes Gesicht wurde gesehen. Möchtest du einen Namen hinterlegen?':`${count} unbekannte Gesichter warten auf eine Zuordnung.`;
  prompt.hidden=!count||next===snoozed||location.pathname==='/faces';
  const active = document.activeElement;
  const editing = active?.tagName === 'INPUT' && faceGrid.contains(active) &&
    candidates.some(candidate => candidate.id === active.closest('.unknown-face-card')?.dataset.candidateId);
  if(next===signature||editing)return;signature=next;faceGrid.replaceChildren();
  if(!count)faceGrid.append(fel('p','small-note face-suggestions-empty','Aktuell keine Vorschläge. Sie erscheinen nach der Auswertung einer Kamera mit aktivierter Gesichtserkennung.'));
  for(const candidate of candidates){
    const card=fel('article','unknown-face-card'),image=fel('img');image.alt='Unbekanntes Gesicht aus dem Kameraclip';image.loading='lazy';image.src=`/api/faces/suggestions/${candidate.id}/image`;
    card.dataset.candidateId = candidate.id;
    let attempts=0;image.onerror=()=>{if(attempts++<3)setTimeout(()=>{image.src=`/api/faces/suggestions/${candidate.id}/image?attempt=${attempts}`;},1500*attempts);};
    const body=fel('div');body.append(fel('h3','',candidate.camera||'Kamera'),fel('p','small-note',new Date(candidate.at).toLocaleString('de-DE')));
    const form=fel('form'),label=fel('label','','Möchtest du einen Namen hinterlegen?'),name=fel('input');name.required=true;name.maxLength=60;name.placeholder='Zum Beispiel Joscha';name.setAttribute('list','known-face-names');label.append(name);
    const save=fel('button','button primary-button','Namen speichern'),skip=fel('button','text-button','Dieses Bild überspringen');save.type='submit';skip.type='button';form.append(label,save,skip);
    form.onsubmit = async event => {
      event.preventDefault();
      if (save.disabled) return;
      save.disabled = skip.disabled = true;
      try {
        await window.tw.action('/api/faces/suggestions/name', {id:candidate.id, name:name.value.trim()});
      } finally {
        save.disabled = skip.disabled = false;
      }
    };
    skip.onclick=()=>window.tw.action('/api/faces/suggestions/ignore',{id:candidate.id});body.append(form);card.append(image,body);faceGrid.append(card);
  }
  document.getElementById('known-face-names')?.remove();const names=fel('datalist');names.id='known-face-names';for(const person of state.ai?.people||[]){const option=fel('option');option.value=person.name;names.append(option);}faceSection.append(names);
});
window.addEventListener('tw-route',({detail:path})=>{prompt.hidden=path==='/faces'||!window.tw.getState()?.faceSuggestions?.total||signature===snoozed;});
