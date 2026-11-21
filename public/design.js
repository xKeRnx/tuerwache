const make = window.tw.element;
const titles = { '/': ['Übersicht', 'Ein Blick auf deine Kameras und die letzten Aufnahmen.'], '/events': ['Ereignisse', 'Klingeln, Bewegungen und Erkennungen im zeitlichen Verlauf.'], '/clips': ['Deine Aufnahmen', 'Gespeicherte Clips ansehen und herunterladen.'], '/cameras': ['Deine Kameras', 'Lege für jede Kamera fest, was Türwache übernehmen soll.'], '/ai': ['KI-Anbieter', 'Wähle lokale Auswertung oder deinen eigenen Cloud-Anbieter.'], '/discord': ['Discord', 'Verbinde deinen Kanal und entscheide, was gemeldet wird.'], '/storage': ['Speicher', 'Deine Aufnahmen lokal speichern und optional in der Cloud sichern.'], '/faces': ['Bekannte Gesichter', 'Verwalte die Personen, die deine lokale KI wiedererkennen soll.'], '/users': ['Benutzer & Zugriff', 'Deine Benutzerkonten, Rollen und Berechtigungen.'], '/connection': ['Kameraverbindungen', 'Verbinde Ring-Konten und Kameras aus deinem Heimnetz.'], '/mobile': ['Handy-App', 'Installation, Verbindungsadresse und Push-Status.'], '/access': ['Server & Fernzugriff', 'Lokalen Betrieb und optionalen geschützten Netzwerkzugriff verwalten.'] };
const paths = {
  '/':'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  '/clips':'M4 4h16v16H4z M9 8l7 4-7 4Z',
  '/events':'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  '/cameras':'M3 7h12v11H3z M15 11l6-3v9l-6-3',
  '/ai':'M12 3l2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z',
  '/ai-review':'M5 3h14v18H5z M8 15l3-3 2 2 3-5',
  '/discord':'M4 4h16v12H9l-5 4Z M8 9h1 M15 9h1 M8 13h8',
  '/storage':'M4 4h16v6H4z M4 14h16v6H4z M7 7h.1 M7 17h.1',
  '/faces':'M8 3H4v4 M16 3h4v4 M4 17v4h4 M20 17v4h-4 M9 9h.1 M15 9h.1 M8 14q4 5 8 0',
  '/users':'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.9',
  '/connection':'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  '/mobile':'M7 2h10v20H7z M11 18h2',
  '/access':'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z M8 12l3 3 5-6',
  '/docs':'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
};
titles['/timeline']=['Dein Zeitstrahl','Aufnahmen, Auslöser und Kurzbeschreibungen nach Zeit und Kamera.'];
titles['/sites']=['Kameras nach Standort','Kamerastatus und letztes Ereignis im Überblick.'];
paths['/timeline']=paths['/events'];
titles['/operations']=['Betrieb','Verbindungen, Speicher und Verarbeitung überwachen.'];titles['/operations/storage']=['Aufbewahrung','Getrennte Regeln für lokale und Cloud-Kopien.'];titles['/operations/backups']=['Sicherungen','Verschlüsselt sichern, prüfen und auf einen neuen Server umziehen.'];titles['/ai-review']=['KI-Qualität','Beschreibungen bewerten und Modelle vergleichen.'];titles['/visits']=['Besuche','Bewegung, Klingeln und Clips eines Besuchs.'];paths['/operations']=paths['/access'];paths['/visits']=paths['/timeline'];
for (const link of document.querySelectorAll('.rail nav a')) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[link.getAttribute('href')] || paths['/']); svg.append(path);
  link.querySelector('span').replaceChildren(svg);
}
const topbar = document.querySelector('.topbar'), account = document.querySelector('.account-actions');
const crumb = make('div','topbar-crumb'); crumb.append(make('span','','Dein Zuhause'),make('span','','/'),make('strong','','Übersicht')); topbar.prepend(crumb);
const identity = make('div','user-identity'), avatar = make('span','user-avatar'); avatar.setAttribute('aria-hidden','true'); identity.append(avatar,document.getElementById('signed-in')); account.prepend(identity);
function pageTitle() {
  const title = titles[location.pathname]; if (!title) return;
  document.querySelector('.heading h1').textContent = title[0]; document.querySelector('.heading h1+p').textContent = title[1];
  document.querySelector('.heading .eyebrow').textContent = ['/', '/events', '/clips','/timeline'].includes(location.pathname) ? 'DEIN ZUHAUSE IM BLICK' : 'DEIN SERVER. DEINE EINSTELLUNGEN.';
  crumb.querySelector('strong').textContent = title[0];
}
window.addEventListener('tw-route', pageTitle);
const stats = make('div','stats-grid');
const cards = ['Kameras verbunden','Aktiv überwacht','Gespeicherte Clips','Lokale KI'].map(label => { const card=make('div','stat-card'), top=make('div','stat-top'); top.append(make('span','',label),make('span','stat-dot')); const value=make('strong','','—'), note=make('small','',''); card.append(top,value,note); stats.append(card); return {value,note}; });
document.querySelector('[data-page="/"]').prepend(stats);
window.addEventListener('tw-state',({detail:state}) => {
  pageTitle(); if (!state.user) return;
  avatar.textContent=state.user.name.slice(0,1).toLocaleUpperCase('de-DE');
  cards[0].value.textContent=state.cameras.length; cards[0].note.textContent=`${state.cameras.filter(c=>!c.offline).length} derzeit online`;
  cards[1].value.textContent=state.cameras.filter(c=>c.features?.monitoring).length; cards[1].note.textContent='Nach deinen Kamera-Profilen';
  cards[2].value.textContent=state.clipCount ?? state.events.filter(e=>e.clip&&e.status==='ready').length; cards[2].note.textContent='Im Aufnahme-Archiv';
  cards[3].value.textContent=state.ai?.modelsReady?'Bereit':'Aus'; cards[3].value.style.fontSize='24px'; cards[3].note.textContent=state.ai?.busy?'Auswertung läuft':'Personen & bekannte Gesichter';
  const camera=state.cameras.find(c=>c.id===document.getElementById('camera-select').value);
  document.querySelector('#video-placeholder h3').textContent=camera?'Ein Blick nach draußen.':'Deine Kameras, an einem Ort.';
  document.querySelector('#video-placeholder p').textContent=camera?'Starte das Livebild oder speichere einen kurzen Clip.':'Füge unter Kameraverbindungen eine Kamera hinzu.';
});
function cardTitle(selector,title) { document.querySelector(selector).prepend(make('h3','',title)); }
cardTitle('#storage-form>div:first-child','Lokal auf deinem Server'); cardTitle('#storage-form>div:nth-child(2)','Cloudflare R2 / S3'); cardTitle('#discord-form>div:first-child','Deine Verbindung'); cardTitle('#discord-form>div:nth-child(2)','So richtest du Discord ein');
const faceSettings=make('form','face-settings'); faceSettings.id='face-threshold-form'; faceSettings.append(make('h3','','Erkennung abstimmen'));
const thresholdLabel=document.querySelector('label[for="face-threshold"]'), threshold=document.getElementById('face-threshold'), thresholdNote=threshold.nextElementSibling;
faceSettings.append(thresholdLabel,threshold,thresholdNote);
const thresholdSave=make('button','button','Ähnlichkeit speichern'); thresholdSave.type='submit'; const thresholdStatus=make('p','small-note'); thresholdStatus.setAttribute('role','status'); faceSettings.append(thresholdSave,thresholdStatus);
faceSettings.onsubmit=async event=>{event.preventDefault();const ok=await window.tw.action('/api/settings',{faceThreshold:Number(threshold.value)});thresholdStatus.textContent=ok?'Gespeichert.':'Nicht gespeichert. Hinweis oben beachten.';};
for (const [id, formId, listId, title] of [['people','face-form','people-list','Deine bekannten Personen'],['users','user-form','user-list','Benutzerkonten']]) {
  const layout=make('div','management-layout'), setup=make('div','setup-card'), list=make('div','list-card');
  setup.append(make('h3','',id==='people'?'Person hinzufügen':'Benutzer hinzufügen'),document.getElementById(formId));
  if(id==='people')setup.append(faceSettings);
  list.append(make('h3','',title),document.getElementById(listId)); layout.append(setup,list); document.getElementById(id).append(layout);
}
pageTitle();
