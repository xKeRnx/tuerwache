const $ = id => document.getElementById(id);
let state = null;
let busy = false;
let lastCameras = '';
let lastEvents = '';
let selectedClip = null;
let toastTimer,jobUser='',jobStates=new Map();
const toast=document.createElement('section');toast.className='feedback-toast';toast.hidden=true;toast.setAttribute('aria-live','polite');toast.setAttribute('aria-atomic','true');
const toastIcon=document.createElement('span');toastIcon.className='feedback-icon';toastIcon.setAttribute('aria-hidden','true');const toastText=document.createElement('div'),toastTitle=document.createElement('strong'),toastDetail=document.createElement('p'),toastClose=document.createElement('button');toastClose.type='button';toastClose.className='feedback-close';toastClose.textContent='×';toastClose.setAttribute('aria-label','Rückmeldung schließen');toastText.append(toastTitle,toastDetail);toast.append(toastIcon,toastText,toastClose);document.body.append(toast);
function dismissFeedback() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}
toastClose.onclick = dismissFeedback;
window.addEventListener('tw-route', dismissFeedback);
window.addEventListener('pagehide', dismissFeedback);
function feedback(message,kind='success',detail=''){
  clearTimeout(toastTimer);toast.hidden=false;toast.dataset.kind=kind;toast.setAttribute('role',kind==='error'?'alert':'status');toast.setAttribute('aria-live',kind==='error'?'assertive':'polite');toastIcon.textContent=kind==='pending'?'':kind==='error'?'!':'✓';toastTitle.textContent=message;toastDetail.textContent=detail;toastDetail.hidden=!detail;
  toastTimer = setTimeout(dismissFeedback, 12_000);
}
function actionMessage(path){return ({'/api/settings':'Einstellungen gespeichert.','/api/camera-settings':'Kamera-Profil gespeichert.','/api/automatic':'Automatische Aufnahme aktualisiert.','/api/capture':'Aufnahme gestartet.','/api/live/start':'Livebild ist bereit.','/api/live/stop':'Livebild beendet.','/api/analyze':'Lokale KI-Auswertung eingeplant.','/api/summarize':'KI-Kurzbeschreibung eingeplant.','/api/cloud/upload':'Cloud-Upload eingeplant.','/api/delete':'Clip gelöscht.','/api/diagnose':'Kamerastatus aktualisiert.','/api/discord/test':'Discord hat die Testnachricht bestätigt.','/api/discord/retry':'Discord-Versand erneut eingeplant.','/api/faces/add':'Foto lokal verarbeitet.','/api/faces/templates/remove':'Gesichtsvorlage entfernt.','/api/faces/remove':'Gesicht und Zuordnungen entfernt.','/api/faces/suggestions/name':'Name und Gesichtsvorlage gespeichert.','/api/faces/suggestions/ignore':'Gesichtsvorschlag übersprungen.','/api/users/add':'Benutzer angelegt.','/api/users/update':'Benutzer aktualisiert.','/api/access/settings':'Betriebseinstellungen gespeichert.','/api/account/mfa/start':'2FA-Einrichtung vorbereitet.','/api/account/mfa/confirm':'Zwei-Faktor-Anmeldung aktiviert.','/api/account/mfa/disable':'Zwei-Faktor-Anmeldung zurückgesetzt.','/api/auth/login':'Du bist angemeldet.','/api/auth/setup':'Administratorkonto angelegt.','/api/auth/logout':'Du bist abgemeldet.','/api/mobile/revoke':'Handy-Anmeldung widerrufen.','/api/models/save':'KI-Modell gespeichert.','/api/models/remove':'KI-Modell entfernt.','/api/models/check':'KI-Verbindung geprüft.','/api/providers/check':'KI-Verbindung geprüft.','/api/ollama/check':'Ollama-Verbindung geprüft.','/api/resume':'Ring-Verbindung wiederhergestellt.','/api/logout':'Ring-Sitzung abgemeldet.','/api/code':'Ring-Anmeldung bestätigt.','/api/login':state?.phase==='two-factor'?'Bitte den Ring-Bestätigungscode eingeben.':'Ring-Anmeldung fortgesetzt.'})[path]||'Aktion erfolgreich abgeschlossen.';}

function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function appendFaceDiagnostics(target, entry) {
  const ai = entry.ai;
  const stats = ai?.faceDiagnostics;
  if (ai?.status !== 'ready' || !stats || !can(entry.cameraId, 'analyze')) return;
  const detail = element('details', 'small-note');
  detail.append(element('summary', '', 'Gesichtserkennung im Clip'));
  if (ai.faceEngine === 'network-arcface') detail.append(element('p', '', 'Mit ArcFace ausgewertet.'));
  const fallback = {
    'not-configured': 'ArcFace ist nicht eingerichtet. SFace hat den Clip lokal ausgewertet.',
    'missing-templates': 'ArcFace-Vorlagen fehlen. SFace hat den Clip lokal ausgewertet.',
    'worker-error': 'Der ArcFace-Worker war nicht verfügbar. SFace hat den Clip lokal ausgewertet.',
  }[ai.arcFaceFallback];
  if (fallback) detail.append(element('p', '', fallback));
  let explanation = 'Die sichtbaren Gesichter lieferten keinen eindeutigen Treffer zu einer Vorlage.';
  if (ai.identityGalleryStale) explanation = 'Die Vorlagen wurden seit dieser Auswertung geändert. Werte den Clip erneut aus.';
  else if (!stats.faceFrames) explanation = 'In den geprüften Bildern wurde kein verwertbares Gesicht gefunden.';
  else if (!stats.knownPeople) explanation = 'Beim Auswerten waren keine Gesichtsvorlagen vorhanden.';
  else if (ai.confirmedIdentities?.length) explanation = 'Der Name wurde über mehrere Bilder bestätigt.';
  else if (stats.matchFrames) explanation = 'Es gab Treffer in Einzelbildern. Für eine sichere Namensbestätigung reichten sie nicht aus.';
  detail.append(element('p', '', explanation));
  const format = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const count = `${stats.faceFrames} von ${ai.sampleCount} Bildern mit Gesicht`;
  const size = `Größtes Gesicht ${stats.largestFacePixels} px`;
  detail.append(element('p', '', stats.faceFrames ? `${count} · ${size}` : count));
  if (Number.isFinite(stats.bestSimilarity)) {
    const score = format.format(stats.bestSimilarity), threshold = format.format(stats.threshold);
    detail.append(element('p', '', `Beste Ähnlichkeit ${score} · Mindestwert ${threshold} · ${stats.matchFrames} Bilder mit eindeutiger Übereinstimmung`));
  }
  target.append(detail);
}

function appendDiscordStatus(target, event) {
  for (const [kind, delivery] of Object.entries(event.discord || {})) {
    const label = { ding:'Klingelmeldung',clip:'Klingel-Clip',motionClip:'Bewegungsclip',person:'Personenmeldung',summary:'KI-Zusammenfassung' }[kind] || 'Nachricht';
    const status = {queued:'eingeplant …',sending:'wird gesendet …',sent:delivery.attachmentSent?'mit Anhang zugestellt':'nur Text zugestellt',disabled:delivery.message,'not-triggered':delivery.message,skipped:delivery.message,error:delivery.message}[delivery.status] || delivery.status;
    const item=element('p',`discord-status small-note ${delivery.status==='error'?'error':''}`,`Discord · ${label}: ${status}${delivery.note?' · '+delivery.note:''}`);
    if(state.user?.role==='admin'&&['error','skipped'].includes(delivery.status)){
      const retry=element('button','text-button','Erneut senden');retry.type='button';retry.onclick=()=>{if(confirm('Diese Discord-Nachricht erneut senden? Bei unklarer Zustellung kann eine doppelte Nachricht entstehen.'))action('/api/discord/retry',{id:event.id,kind});};item.append(document.createTextNode(' '),retry);
    }
    target.append(item);
  }
  const profile=state.cameraProfiles?.[event.cameraId],kind=event.trigger==='motion'?'motionClip':event.trigger==='ding'?'clip':null;
  if(state.user?.role==='admin'&&event.status==='ready'&&event.clip&&kind&&!event.discord?.[kind]&&state.settings?.discord.enabled&&profile?.monitoring&&profile[kind==='motionClip'?'discordMotionClip':'discordDingClip']){
    const send=element('button','text-button','Video an Discord senden');send.type='button';send.onclick=()=>{if(confirm('Diesen gespeicherten Clip jetzt an den eingerichteten Discord-Kanal senden?'))action('/api/discord/retry',{id:event.id,kind});};target.append(send);
  }
}

async function action(path, body = {}) {
  if (busy || !state) return false;
  let success = false;
  busy = true;
  feedback(['/api/camera-settings','/api/settings','/api/access/settings'].includes(path)?'Wird gespeichert …':path==='/api/live/start'?'Livebild wird verbunden …':'Aktion wird ausgeführt …','pending');
  notice('');
  render();
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': state.csrf }, body: JSON.stringify(body) })
      .catch(() => { throw new Error('Die Verbindung zum Türwache-Server wurde unterbrochen. Bitte erneut versuchen.'); });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Aktion fehlgeschlagen.');
    success = result;
  } catch (error) { notice(error.message); feedback('Aktion fehlgeschlagen.','error',error.message); }
  finally { busy = false; await refresh(); }
  if(success)feedback(actionMessage(path));
  return success;
}

function can(cameraId, actionName) {
  if (!state?.user) return false;
  if (state.user.role === 'admin') return true;
  if (cameraId && state.sites) {
    const camera = state.cameras.find(item => item.id === cameraId) || state.sites.flatMap(site => site.cameras).find(item => item.id === cameraId);
    if (state.permissions) return camera?.permissions?.includes(actionName) ?? false;
  }
  if (state.permissions) return state.permissions.includes(actionName);
  return ['events', 'clips', 'live', 'export', 'push'].includes(actionName) || state.user.role === 'operator' && ['capture', 'analyze', 'review', 'protect'].includes(actionName);
}
const selectedRing = () => state?.ringConnections?.find(account => account.id === $('ring-account').value) || state;

function showClip(filename) {
  window.tw.stopLive?.();
  window.tw.navigate?.('/');
  selectedClip = filename;
  $('player').src = `/clips/${filename}`;
  $('player').hidden = false;
  $('video-placeholder').hidden = true;
  $('player').play().catch(() => {});
  $('viewport').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderEvents() {
  const signature = JSON.stringify([state.user?.role, state.sites, state.permissions, state.settings?.cloud.enabled, state.cameraProfiles, state.events]);
  if (lastEvents === signature) return;
  lastEvents = signature;
  $('event-count').textContent = state.events.length;
  const container = $('events');
  container.replaceChildren();
  if (!state.events.length) {
    const empty = element('div', 'empty');
    empty.append(element('span', '', '◷'), element('p', '', 'Hier erscheinen Klingeln, Bewegung und deine Testclips.'));
    container.append(empty);
    return;
  }
  const labels = { ding: 'Es hat geklingelt', motion: 'Bewegung', clip: 'Aufnahme', system: 'Verbindung & Einstellungen' };
  for (const event of state.events) {
    const profile = state.cameraProfiles?.[event.cameraId];
    const row = element('div', `event-row ${event.status === 'error' ? 'error' : ''}`);
    row.append(element('span', 'event-icon', event.type === 'clip' ? '▣' : event.type === 'ding' ? '♧' : '◷'));
    const body = element('div', 'event-body');
    body.append(element('span', 'event-title', `${labels[event.type] ?? 'Ereignis'}${event.camera ? ` · ${event.camera}` : ''}`));
    body.append(element('p', 'event-message', event.message));
    if(event.recordingDecision&&event.recordingDecision.status!=='recorded')body.append(element('p','small-note',event.recordingDecision.message));
    const parts = [new Date(event.at).toLocaleString('de-DE')];
    if (event.firstFrameMs !== undefined) parts.push(`Erste Videodaten nach ${(event.firstFrameMs / 1000).toFixed(1)} s`);
    if (event.pushDelayMs !== undefined) parts.push(`Ring-Meldung nach ${(event.pushDelayMs / 1000).toFixed(1)} s`);
    if (event.firstFileBytesMs !== undefined) parts.push(`Datei begonnen nach ${(event.firstFileBytesMs / 1000).toFixed(1)} s`);
    if (event.video?.durationSeconds !== undefined) parts.push(`${event.video.durationSeconds.toFixed(1)} s Video`);
    if (event.video?.width && event.video?.height) parts.push(`${event.video.width} × ${event.video.height}`);
    if (event.bytes) parts.push(`${(event.bytes / 1048576).toFixed(1)} MB`);
    body.append(element('span', 'event-meta', parts.join(' · ')));
    if (event.ai) {
      let label = event.ai.status === 'ready' ? (event.ai.personDetected ? `${event.ai.personDetectionEnabled === false ? 'Gesicht' : 'Person'} erkannt${event.ai.maxPeople > 1 ? ` · bis zu ${event.ai.maxPeople} gleichzeitig` : ''}` : `Kein${event.ai.personDetectionEnabled === false ? ' Gesicht' : 'e Person'} in den geprüften Bildern erkannt`) : ({ queued: 'KI eingeplant …', working: 'Lokale KI wertet aus …', error: event.ai.message }[event.ai.status] || 'KI ausstehend');
      if (event.ai.status === 'ready') {
        if (event.ai.names.length) label += ` · ${event.ai.names.join(', ')} · über mehrere Bilder bestätigt`;
        if (event.ai.unconfirmedFace) label += ' · Name noch nicht über mehrere Bilder bestätigt';
        if (event.ai.identityGalleryStale) label += ' · Gesichtsvorlagen geändert; Namen erneut prüfen';
        if (event.ai.unknownFace) label += ' · unbekanntes Gesicht';
        if (event.ai.personDetected && !event.ai.faceVisible && event.ai.faceRecognitionEnabled !== false) label += ' · kein Gesicht ausreichend sichtbar';
        label += ` · ${event.ai.sampleCount} Bilder`;
      }
      body.append(element('p', 'ai-result', label));
      appendFaceDiagnostics(body, event);
    }
    if (event.summary) {
      const summary = element('div', 'summary-result');
      summary.append(element('p', '', event.summary.status === 'ready' ? event.summary.text : ({ queued: 'Szenenbeschreibung eingeplant …', working: 'KI beschreibt die Szene …', error: event.summary.message, skipped: event.summary.message }[event.summary.status] || '')));
      if (event.summary.status === 'ready') summary.append(element('span', 'small-note', `${state.summaryService?.providerCatalog?.find(item => item.id === event.summary.provider)?.name || event.summary.provider} · ${event.summary.model} · ${event.summary.frameCount} Bilder · KI-Beschreibung kann Fehler enthalten`));
      body.append(summary);
    }
    if (event.cloud) body.append(element('p', `ai-result ${event.cloud.status === 'error' ? 'warning' : ''}`, ({ queued: 'Cloud-Upload eingeplant …', uploading: 'Cloud-Upload läuft …', uploaded: 'Cloud-Kopie in R2 / S3 gespeichert', deleted: 'Cloud-Kopie gelöscht', skipped: event.cloud.message, error: event.cloud.message }[event.cloud.status] || '')));
    appendDiscordStatus(body,event);
    if (event.clip && event.status === 'ready') {
      const actions = element('div', 'event-actions');
      const play = element('button', '', 'Clip ansehen'); play.type = 'button'; play.onclick = () => showClip(event.clip);
      const download = element('a', '', 'Herunterladen'); download.href = `/api/clips/${event.id}/export`; download.download = event.clip;
      const remove = element('button', 'delete', 'Löschen'); remove.type = 'button'; remove.onclick = async () => {
        if (confirm('Diesen Clip und eine eventuell vorhandene R2/S3-Kopie löschen?')) {
          if (selectedClip === event.clip) { selectedClip = null; $('player').pause(); $('player').removeAttribute('src'); $('player').load(); $('player').hidden = true; $('video-placeholder').hidden = false; }
          await action('/api/delete', { id: event.id });
        }
      };
      actions.append(play);
      if (can(event.cameraId, 'export')) actions.append(download);
      if (can(event.cameraId, 'delete')) actions.append(remove);
      if (can(event.cameraId, 'analyze')) {
        const analyze = element('button', '', 'KI auswerten'); analyze.disabled = !profile?.monitoring || (!profile.personDetection && !profile.faceRecognition) || ['working', 'queued'].includes(event.ai?.status) || !state.ai?.modelsReady; analyze.title = 'Verwendet die im Kamera-Profil aktivierten KI-Funktionen'; analyze.onclick = () => action('/api/analyze', { id: event.id }); actions.append(analyze);
        const summarize = element('button', '', 'Szene beschreiben'); summarize.disabled = !profile?.monitoring || !profile.summaryProvider || profile.summaryProvider === 'off' || ['queued', 'working'].includes(event.summary?.status); summarize.title = 'Verwendet den im Kamera-Profil gewählten Anbieter'; summarize.onclick = () => action('/api/summarize', { id: event.id }); actions.append(summarize);
      }
      if (state.user?.role === 'admin') {
        if (profile?.monitoring && profile.cloudUpload && state.settings?.cloud.enabled && !['uploaded', 'uploading', 'queued'].includes(event.cloud?.status)) { const upload = element('button', '', 'In Cloud sichern'); upload.onclick = () => action('/api/cloud/upload', { id: event.id }); actions.append(upload); }
      }
      body.append(actions);
    }
    row.append(body); container.append(row);
  }
}

function render() {
  if (!state) return;
  if(state.appVersion&&state.appVersion!=='0.13.1'&&!document.getElementById('version-update')){const banner=element('aside','face-prompt');banner.id='version-update';banner.append(element('span','','Eine neue Türwache-Version ist verfügbar.'));const update=element('button','button','Neue Version laden');update.type='button';update.onclick=()=>location.reload();banner.append(update);document.querySelector('.heading').after(banner);}
  const signedIn = Boolean(state.user);
  document.body.classList.toggle('signed-out', !signedIn);
  $('auth-screen').hidden = signedIn;
  if (!signedIn) { $('player').pause(); $('player').removeAttribute('src'); selectedClip = null; lastEvents = '';jobStates.clear();jobUser='';window.dispatchEvent(new CustomEvent('tw-state',{detail:state})); return; }
  document.querySelectorAll('[data-admin]').forEach(node => { node.hidden = state.user.role !== 'admin'; });
  $('signed-in').textContent = `${state.user.name} · ${state.user.roleName || { admin: 'Administrator', operator: 'Bediener', viewer: 'Betrachter' }[state.user.role]}`;
  const connected = state.phase === 'connected';
  const accountSelect = $('ring-account');
  const accounts = state.ringConnections || [{ id: 'primary', name: 'Standardkonto' }];
  const currentOptions = [...accountSelect.options].map(option => [option.value, option.textContent]);
  const options = accounts.map(account => [account.id, account.name]);
  if (JSON.stringify(currentOptions) !== JSON.stringify(options)) {
    const selected = accountSelect.value;
    accountSelect.replaceChildren(...options.map(([id, name]) => {
      const option = element('option', '', name); option.value = id; return option;
    }));
    if (accounts.some(account => account.id === selected)) accountSelect.value = selected;
  }
  const ring = selectedRing();
  const pending = ['connecting', 'authenticating'].includes(ring.phase);
  const ringConnected = ring.phase === 'connected';
  const twoFactor = ring.phase === 'two-factor' || (ring.phase === 'authenticating' && !$('code-form').hidden);
  $('connection-badge').textContent = connected ? 'Kameras verbunden' : pending ? 'Verbindung läuft …' : 'Keine aktive Kameraverbindung';
  $('connection-badge').classList.toggle('neutral', !connected);
  $('connection-message').textContent = ring.cameraCount === undefined ? ring.message : `${ring.message} ${ring.cameraCount} Kamera(s).`;
  $('login-form').hidden = ringConnected || twoFactor || ring.phase === 'connecting';
  $('code-form').hidden = ringConnected || !twoFactor;
  document.querySelectorAll('#login-form button, #login-form input, #code-form button, #code-form input').forEach(node => { node.disabled = busy || pending; });
  $('logout').hidden = !ringConnected && !ring.hasSavedSession && !twoFactor;
  $('logout').disabled = busy || pending;
  $('resume').hidden = ringConnected || !ring.hasSavedSession || twoFactor;
  $('resume').disabled = busy || pending;
  $('ring-remove').hidden = !ring.id || ring.id === 'primary';
  $('ring-remove').disabled = busy || pending;
  accountSelect.disabled = busy;
  const camerasSignature = JSON.stringify(state.cameras);
  if (lastCameras !== camerasSignature) {
    lastCameras = camerasSignature;
    const selected = $('camera-select').value;
    $('camera-select').replaceChildren();
    for (const camera of state.cameras) {
      const option = element('option', '', camera.name); option.value = camera.id; $('camera-select').append(option);
    }
    if (!state.cameras.length) { const option = element('option', '', 'Noch keine Kamera'); option.value = ''; $('camera-select').append(option); }
    if (state.cameras.some(camera => camera.id === selected)) $('camera-select').value = selected;
  }
  const camera = state.cameras.find(item => item.id === $('camera-select').value);
  const selectedRecording=state.recordings?.find(job=>job.cameraId===camera?.id)||(state.recording?.cameraId===camera?.id?state.recording:null);
  $('capture').textContent=`● ${camera?.features?.recordingSeconds??10} Sekunden aufnehmen`;
  $('automatic-details').textContent=`${camera?.features?.recordingSeconds??10} Sekunden je Clip · ${camera?.features?.recordingCooldownSeconds??60} Sekunden Mindestabstand zwischen Starts`;
  $('camera-select').disabled = !connected || busy;
  $('camera-title').textContent = camera?.name ?? 'Deine Haustür';
  $('camera-detail').textContent = camera ? `${camera.model}${camera.battery !== null ? ` · Akku ${camera.battery}%` : ''}` : 'Ring Battery Video Doorbell Pro';
  $('camera-badge').textContent = selectedRecording ? 'Aufnahme läuft' : camera ? (!camera.features?.monitoring ? 'Überwachung pausiert' : camera.offline ? 'Offline' : 'Bereit') : 'Noch nicht verbunden';
  $('camera-badge').classList.toggle('neutral', !camera || camera.offline);
  $('capture').disabled = !can(camera?.id, 'capture') || !connected || !camera || !camera.features?.monitoring || camera.offline || Boolean(selectedRecording) || busy || !state.ffmpeg;
  $('recording-indicator').hidden = !selectedRecording;
  $('automatic').disabled = !connected || !camera?.features?.monitoring || busy;
  $('automatic').checked = Boolean(camera?.features?.monitoring && (camera.features.recordMotion || camera.features.recordDing));
  $('automatic').indeterminate = Boolean(camera?.features?.monitoring && camera.features.recordMotion !== camera.features.recordDing);
  $('diagnose').disabled = !connected || !camera || busy;
  const pushLabels = {
    'not-connected': 'Ereignisempfang noch nicht verbunden.',
    registering: 'Klingel- und Bewegungsabos werden vorbereitet …',
    subscribed: 'Ereignisabos erneuert. Empfang mit echtem Klingeln oder Bewegung prüfen.',
    'registration-failed': 'Ereignisabos konnten teilweise nicht erneuert werden. Bitte Empfang prüfen.',
  };
  $('push-status').textContent = camera?.source === 'network' ? 'IP-Kamera im lokalen Netzwerk.' :
    (pushLabels[state.pushStatus] ?? pushLabels['not-connected']);
  const diagnostic = state.diagnostics?.cameraId === camera?.id ? state.diagnostics : null;
  $('diagnostic-result').hidden = !diagnostic;
  if (diagnostic) {
    const details = [`Geprüft: ${new Date(diagnostic.checkedAt).toLocaleTimeString('de-DE')}`, diagnostic.online ? 'Kamera online' : 'Kamera offline'];
    if (diagnostic.battery !== null) details.push(`Akku ${diagnostic.battery}%`);
    if (diagnostic.wifiSignal !== null) details.push(`WLAN ${diagnostic.wifiSignal} dBm`);
    details.push(diagnostic.liveViewDisabled ? 'Livebild in Ring deaktiviert' : 'Livebild nicht durch Gerätemodus gesperrt');
    if (!diagnostic.healthRead) details.push('Zusätzlicher Gerätestatus nicht abrufbar');
    $('diagnostic-result').textContent = details.join(' · ');
  }
  $('server-status').textContent = state.ffmpeg ? 'Lokaler Server bereit · FFmpeg verfügbar' : 'FFmpeg fehlt · Installation prüfen';
  $('ai-health').textContent = state.ai?.modelsReady ? (state.ai.busy ? 'KI arbeitet auf deinem Server …' : 'Lokale KI-Modelle bereit') : 'KI-Modelle auf dem Server noch installieren';
  renderEvents();
  const first=jobUser!==state.user.id;if(first){jobStates.clear();jobUser=state.user.id;}
  for(const entry of state.events){const previous=jobStates.get(entry.id);if(previous&&!first){
    if(previous.status==='recording'&&entry.status==='ready')feedback('Aufnahme gespeichert.','success',`${entry.camera||'Kamera'} · im Clip-Archiv verfügbar`);
    for(const [key,label]of[['ai','Lokale KI-Auswertung'],['summary','KI-Kurzbeschreibung'],['cloud','Cloud-Upload']])if(['queued','working','uploading'].includes(previous[key])&&['ready','uploaded','error'].includes(entry[key]?.status)){feedback(entry[key].status==='error'?`${label} fehlgeschlagen.`:`${label} abgeschlossen.`,entry[key].status==='error'?'error':'success',entry[key].status==='error'?entry[key].message||'Einstellungen und Ereignis prüfen.':'Das Ergebnis steht beim Clip und im Zeitstrahl.');}
  }jobStates.set(entry.id,{status:entry.status,ai:entry.ai?.status,summary:entry.summary?.status,cloud:entry.cloud?.status});}
  while(jobStates.size>200)jobStates.delete(jobStates.keys().next().value);
  window.dispatchEvent(new CustomEvent('tw-state', { detail: state }));
}

async function refresh() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error();
    state = await response.json();
    render();
  } catch { $('server-status').textContent = 'Lokaler Server nicht erreichbar'; $('capture').disabled = true; $('automatic').disabled = true; }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('password').value;
  $('password').value = '';
  await action('/api/login', { email: $('email').value, password, accountId: $('ring-account').value });
  if (selectedRing()?.phase === 'two-factor') $('code').focus();
});
$('code-form').addEventListener('submit', async event => { event.preventDefault(); const code = $('code').value.trim(); $('code').value = ''; await action('/api/code', { code, accountId: $('ring-account').value }); });
$('capture').addEventListener('click', () => action('/api/capture', { cameraId: $('camera-select').value }));
$('automatic').addEventListener('change', event => action('/api/automatic', { cameraId: $('camera-select').value, enabled: event.target.checked }));
$('camera-select').addEventListener('change', render);
$('logout').addEventListener('click', () => action('/api/logout', { accountId: $('ring-account').value }));
$('resume').addEventListener('click', () => action('/api/resume', { accountId: $('ring-account').value }));
$('ring-account').addEventListener('change', () => { $('email').value = $('password').value = $('code').value = ''; $('code-form').hidden = true; render(); });
$('diagnose').addEventListener('click', () => action('/api/diagnose', { cameraId: $('camera-select').value }));
$('player').addEventListener('error', () => notice('Der Clip konnte im Browser nicht abgespielt werden. Du kannst ihn herunterladen und mit VLC öffnen.'));
async function poll() { await refresh(); setTimeout(poll, 2000); }
window.tw = { action, refresh, can, element,feedback,actionMessage,appendDiscordStatus,appendFaceDiagnostics, getState: () => state };
poll();
