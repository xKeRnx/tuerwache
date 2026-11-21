const ui = id => document.getElementById(id);
let settingsSignature = '', profilesSignature = '', discordSignature = '';
let pendingLogin = null;
const loginButton = ui('app-login-button'), loginBack = ui('app-login-back');
const loginName = ui('app-name'), loginPassword = ui('app-password'), loginCode = ui('app-otp');

function renderLogin(setupRequired) {
  const confirmCode = Boolean(pendingLogin);
  ui('auth-title').textContent = confirmCode ? 'Zwei-Faktor-Anmeldung' : setupRequired ? 'Deine Türwache einrichten.' : 'Willkommen zurück.';
  ui('auth-description').textContent = confirmCode ? 'Gib den Code aus deiner Authenticator-App oder einen Wiederherstellungscode ein.' : setupRequired ? 'Lege dein erstes Administratorkonto an. Wähle ein eigenes Passwort mit mindestens 12 Zeichen.' : 'Melde dich mit deinem Türwache-Konto an.';
  loginButton.textContent = confirmCode ? 'Code bestätigen' : setupRequired ? 'Administratorkonto anlegen' : 'Anmelden';
  loginPassword.autocomplete = setupRequired ? 'new-password' : 'current-password';
  ui('app-credentials').hidden = loginName.disabled = loginPassword.disabled = confirmCode;
  loginBack.hidden = ui('app-mfa').hidden = loginCode.disabled = !confirmCode;
}

function loginNotice(message = '') {
  const notice = ui('auth-notice');
  notice.textContent = message;
  notice.hidden = !message;
}

window.addEventListener('tw-state', event => {
  const state = event.detail;
  if (state.user) pendingLogin = null;
  renderLogin(state.setupRequired);
  if (!state.user) { settingsSignature = ''; profilesSignature = ''; discordSignature = ''; return; }
  if (state.user.role !== 'admin') return;
  const discord = state.settings.discord;
  if (JSON.stringify(discord) !== discordSignature && !ui('discord-form').contains(document.activeElement)) {
    discordSignature = JSON.stringify(discord);
    ui('discord-enabled').checked = discord.enabled;
    ui('discord-cooldown').value = discord.personCooldownSeconds;
    ui('discord-secret-status').textContent = discord.webhookSet ? 'Webhook gespeichert. Leer lassen, um die gespeicherte URL zu behalten.' : 'Noch kein Webhook gespeichert. URL ausschließlich hier eingeben.';
  }
  ui('discord-badge').textContent = discord.enabled && discord.webhookSet ? 'Versand freigegeben' : discord.webhookSet ? 'Versand ausgeschaltet' : 'Noch nicht eingerichtet';
  ui('discord-test').disabled = !discord.enabled || !discord.webhookSet;
  const signature = JSON.stringify(state.settings);
  if (signature !== settingsSignature && !ui('storage-form').contains(document.activeElement)) {
    settingsSignature = signature;
    const settings = state.settings;
    ui('clips-directory').value = settings.clipsDirectory;
    ui('face-threshold').value = settings.faceThreshold;
    ui('cloud-enabled').checked = settings.cloud.enabled;
    for (const key of ['endpoint', 'bucket', 'region', 'prefix']) ui(`s3-${key}`).value = settings.cloud[key];
    ui('cloud-credentials').textContent = settings.cloud.credentialsSet ? 'S3-Schlüssel sind gespeichert. Leere Felder behalten sie bei.' : 'Noch keine S3-Schlüssel gespeichert.';
  }
  const el = window.tw.element;
  ui('monitoring-count').textContent = `${state.cameras.filter(camera => camera.features?.monitoring).length} von ${state.cameras.length} überwacht`;
  const profileSignature = JSON.stringify([state.cameras, state.settings.cloud.enabled, state.settings.discord.enabled, state.settings.summaries]);
  if (profileSignature !== profilesSignature && !ui('camera-profile-list').contains(document.activeElement)) {
    profilesSignature = profileSignature;
    renderCameraProfiles(state);
  }

});
ui('app-login').onsubmit = async event => {
  event.preventDefault();
  const state = window.tw.getState();
  if (!state || loginButton.disabled) return;
  const verifyingCode = Boolean(pendingLogin);
  const credentials = pendingLogin ?? { name: loginName.value, password: loginPassword.value };
  const otp = loginCode.value.trim();
  if (verifyingCode && !otp) { loginCode.focus(); return; }
  loginNotice();
  loginPassword.value = loginCode.value = '';
  loginButton.disabled = loginBack.disabled = true;
  try {
    const response = await fetch(state.setupRequired ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Local-Token': state.csrf },
      body: JSON.stringify({ ...credentials, otp }),
    });
    const result = await response.json();
    // Static frontend files may be newer than the running server until it restarts.
    const requiresCode = result.code === 'MFA_REQUIRED' ||
      result.error === 'Aktuellen 2FA-Code oder unbenutzten Wiederherstellungscode eingeben.';
    if (response.ok) {
      pendingLogin = null;
      await window.tw.refresh();
    } else if (!state.setupRequired && !verifyingCode && requiresCode) {
      pendingLogin = credentials;
      renderLogin(false);
      loginCode.focus();
    } else {
      loginNotice(result.error ?? 'Anmeldung fehlgeschlagen.');
      (verifyingCode ? loginCode : loginPassword).focus();
    }
  } catch {
    loginNotice('Anmeldung fehlgeschlagen.');
    (verifyingCode ? loginCode : loginPassword).focus();
  } finally {
    loginButton.disabled = loginBack.disabled = false;
  }
};
loginBack.onclick = () => {
  pendingLogin = null;
  loginCode.value = '';
  loginNotice();
  renderLogin(false);
  loginPassword.focus();
};
ui('app-logout').onclick = async () => { await window.tw.action('/api/auth/logout'); location.reload(); };
ui('storage-form').onsubmit = async event => {
  event.preventDefault();
  const cloud = { enabled: ui('cloud-enabled').checked, accessKeyId: ui('s3-access').value, secretAccessKey: ui('s3-secret').value };
  for (const key of ['endpoint', 'bucket', 'region', 'prefix']) cloud[key] = ui(`s3-${key}`).value;
  ui('s3-access').value = ''; ui('s3-secret').value = '';
  const ok = await window.tw.action('/api/settings', { clipsDirectory: ui('clips-directory').value, cloud });
  ui('settings-status').textContent = ok ? 'Gespeichert.' : 'Nicht gespeichert – Hinweis oben beachten.';
};
ui('clear-cloud').onclick = async () => { if (confirm('Cloud-Schlüssel entfernen und zukünftige Uploads ausschalten? Vorhandene Cloud-Kopien bleiben erhalten.')) await window.tw.action('/api/settings', { cloud: { clearCredentials: true } }); };
ui('discord-form').onsubmit = async event => {
  event.preventDefault();
  const discord = { enabled: ui('discord-enabled').checked, webhookUrl: ui('discord-webhook').value, personCooldownSeconds: Number(ui('discord-cooldown').value) };
  ui('discord-webhook').value = '';
  const ok = await window.tw.action('/api/settings', { discord });
  ui('discord-save-status').textContent = ok ? 'Discord-Einstellungen gespeichert.' : 'Nicht gespeichert – Hinweis oben beachten.';
};
ui('discord-test').onclick = async () => {
  const ok = await window.tw.action('/api/discord/test');
  ui('discord-save-status').textContent = ok ? 'Testnachricht von Discord bestätigt.' : 'Versand fehlgeschlagen – Hinweis oben beachten.';
};
ui('discord-clear').onclick = async () => {
  if (confirm('Gespeicherten Webhook entfernen und zukünftigen Versand ausschalten? Bereits gesendete Nachrichten bleiben in Discord.')) await window.tw.action('/api/settings', { discord: { clearWebhook: true } });
};
ui('user-form').onsubmit = async event => {
  event.preventDefault(); const password = ui('user-password').value; ui('user-password').value = '';
  const role = ui('user-role').value;
  const permissions = role !== 'admin' && ui('user-no-cameras')?.checked ? { restricted: true, sites: [], cameras: [], rules: [] } : undefined;
  if (await window.tw.action('/api/users/add', { name: ui('user-name').value, password, role, permissions })) ui('user-form').reset();
};
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

const cameraTabs = new Map();
const cameraSaved = new Map();
function renderCameraProfiles(state) {
  const el = window.tw.element, container = ui('camera-profile-list');
  container.replaceChildren();
  const active = state.cameras.filter(camera => camera.features?.monitoring).length;
  ui('monitoring-count').textContent = `${active} von ${state.cameras.length} überwacht`;
  if (!state.cameras.length) { container.append(el('p', 'small-note', 'Füge unter Kameraverbindungen eine Kamera hinzu. Gespeicherte Profile bleiben erhalten.')); return; }
  const definitions = [
    ['monitoring', 'In Türwache überwachen', 'Hauptschalter für diese Kamera'],
    ['recordMotion', 'Bei Bewegung aufnehmen', 'Mit der unten eingestellten Clipdauer aufnehmen'],
    ['extendRecording','Bei weiterer Aktivität verlängern','Bewegung und Klingeln gehören zu einem Besuch; bis höchstens 60 Sekunden verlängern.'],
    ['recordDing', 'Beim Klingeln aufnehmen', 'Klingelereignisse als Aufnahme-Auslöser nutzen'],
    ['personDetection', 'Personenerkennung', 'Personen lokal in gespeicherten Clips suchen'],
    ['faceRecognition', 'Bekannte Gesichter erkennen', 'Gesichter lokal mit deiner Namensliste vergleichen'],
    ['cloudUpload', 'R2 / S3-Kopie', state.settings.cloud.enabled ? 'Neue Clips zusätzlich in deinen Bucket kopieren' : 'Vorbereitet; Cloud-Verbindung unter Speicher noch freigeben'],
    ['discordDing', 'Discord: Klingeln sofort melden', 'Textmeldung beim Empfang eines Klingelereignisses'],
    ['discordDingClip', 'Discord: Klingel-Clip nachsenden', 'Benötigt „Beim Klingeln aufnehmen“; fertiges MP4 senden'],
    ['discordMotionClip', 'Discord: Bewegungsclip senden', 'Fertiges MP4 auch ohne erkannte Person senden'],
    ['discordPerson', 'Discord: Person erkannt melden', 'Benötigt einen aufgenommenen Clip und aktivierte lokale KI'],
    ['discordPersonImage', 'Discord: Personenbild mitsenden', 'Bild zur Personenmeldung aus einem geprüften Videobild'],
    ['discordSummary', 'Discord: KI-Zusammenfassung senden', 'Kurze Szenenbeschreibung nach fertiger Auswertung senden'],
    ['discordSummaryImage', 'Discord: Bild zur Zusammenfassung', 'Szenenbild auch dann senden, wenn keine Person erkannt wurde'],
  ];
  for (const camera of state.cameras) {
    const network = camera.source === 'network';
    const form = el('form', 'camera-profile-card'); form.setAttribute('aria-label', `Profil ${camera.name}`);
    const top = el('div', 'profile-card-top'); const heading = el('div');
    heading.append(el('h3', '', camera.name), el('p', 'small-note', `${camera.model} · ${camera.offline ? 'Offline' : 'Online'}`));
    const status = el('span', 'badge neutral', camera.features.monitoring ? 'Überwacht' : 'Pausiert');
    top.append(heading, status); form.append(top);
    const tabs = el('div', 'profile-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', `Funktionen für ${camera.name}`);
    const panes = {}, tabButtons = {};
    for (const [key, label] of [['record', 'Aufnahme'], ['ai', 'KI & Gesichter'], ['notifications', 'Meldungen'], ['cloud', 'Cloud']]) {
      const button=el('button','',label); button.type='button'; button.setAttribute('role','tab');
      const pane=el('div','profile-pane'); pane.setAttribute('role','tabpanel'); pane.setAttribute('aria-label',`${label} für ${camera.name}`);
      const index=container.childElementCount; pane.id=`camera-pane-${index}-${key}`; button.id=`camera-tab-${index}-${key}`; button.setAttribute('aria-controls',pane.id); pane.setAttribute('aria-labelledby',button.id);
      button.onclick=()=>{cameraTabs.set(camera.id,key); for(const [name, target] of Object.entries(panes)){target.hidden=name!==key; tabButtons[name].setAttribute('aria-selected',String(name===key));}};
      panes[key]=pane;tabButtons[key]=button;tabs.append(button);
    }
    const fields = {};
    for (const [key, label, detail] of definitions) {
      if (network && ['recordDing', 'discordDing', 'discordDingClip'].includes(key)) continue;
      const row = el('label', `toggle-row profile-toggle ${key === 'monitoring' ? 'profile-master' : ''}`), caption = el('span', '', label);
      caption.append(el('span', 'muted', detail));
      const input = el('input'); input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.name = key; input.checked = camera.features[key];
      row.append(caption, input); (key==='monitoring'?form:key.startsWith('discord')?panes.notifications:key==='cloudUpload'?panes.cloud:['personDetection','faceRecognition'].includes(key)?panes.ai:panes.record).append(row); fields[key] = input;
    }
    form.append(tabs,...Object.values(panes)); (tabButtons[cameraTabs.get(camera.id)]||tabButtons.record).click();
    const cloudLink=el('a','text-button','Cloud-Speicher einrichten →'); cloudLink.href='/storage'; panes.cloud.append(cloudLink);
    const discordLink=el('a','text-button','Discord-Verbindung einrichten →'); discordLink.href='/discord'; panes.notifications.append(discordLink);
    const durationLabel=el('label','profile-summary-label','Clipdauer'),duration=el('select'); duration.setAttribute('aria-label',`Clipdauer für ${camera.name}`);
    for(const seconds of [10,20,30,45,60]){const option=el('option','',`${seconds} Sekunden`);option.value=String(seconds);duration.append(option);}duration.value=String(camera.features.recordingSeconds??10);durationLabel.append(duration);
    const cooldownLabel=el('label','profile-summary-label','Mindestabstand zwischen Aufnahmestarts (Sekunden)'),cooldown=el('input');cooldown.type='number';cooldown.min='10';cooldown.max='3600';cooldown.step='1';cooldown.required=true;cooldown.value=String(camera.features.recordingCooldownSeconds??60);cooldown.setAttribute('aria-label',`Aufnahmeabstand für ${camera.name}`);cooldownLabel.append(cooldown);
    const recordingNote = network ? 'Die Voraufnahme stellst du unter Kameraverbindungen ein.' :
      'Ring startet den Stream beim Auslösen. Akkukameras brauchen unter Umständen Zeit zum Aufwachen.';
    panes.record.append(durationLabel, cooldownLabel, el('p', 'small-note', recordingNote));
    const sync = () => {
      for (const [key, input] of Object.entries(fields)) if (key !== 'monitoring') input.disabled = !fields.monitoring.checked;
      provider.disabled = !fields.monitoring.checked; context.disabled = !fields.monitoring.checked; duration.disabled=!fields.monitoring.checked;cooldown.disabled=!fields.monitoring.checked;
      status.textContent = fields.monitoring.checked ? 'Überwacht' : 'Pausiert';
    };
    const summaryLabel = el('label', 'profile-summary-label', 'Szenenbeschreibung durch'); const provider = el('select'); provider.setAttribute('aria-label', `KI-Modell für ${camera.name}`);
    const modelChoices = state.summaryService?.modelChoices || [];
    for (const [value, label] of [['off', 'Aus'], ...modelChoices.map(item => [item.id, item.name])]) { const option = el('option', '', label); option.value = value; if (value !== 'off') option.dataset.i18nSkip = ''; provider.append(option); }
    if (camera.features.summaryProvider && camera.features.summaryProvider !== 'off' && !modelChoices.some(item => item.id === camera.features.summaryProvider)) { const option = el('option', '', 'Modell noch nicht eingerichtet'); option.value = camera.features.summaryProvider; provider.append(option); }
    provider.value = camera.features.summaryProvider || 'off'; summaryLabel.append(provider);
    const contextLabel = el('label', 'profile-summary-label', 'Ortsbeschreibung für die KI (optional)'); const context = el('textarea'); context.maxLength = 400; context.rows = 2; context.placeholder = 'Zum Beispiel: Die Treppe führt zur Haustür.'; context.value = camera.features.sceneContext || ''; context.setAttribute('aria-label', `Ortsbeschreibung für ${camera.name}`); contextLabel.append(context);
    panes.ai.append(summaryLabel, contextLabel, el('p', 'small-note', 'Für Szenenbeschreibungen gilt genau dieser eine Anbieter. Personen- und Gesichtserkennung laufen unabhängig lokal. Cloud-Anbieter erhalten Bilder und Ortsbeschreibung. KI kann Fehler enthalten.'));
    fields.monitoring.onchange = sync; sync();
    const save = el('button', 'button primary-button full', 'Kamera-Profil speichern'); save.type = 'submit';
    const feedback = el('p', 'small-note profile-feedback',cameraSaved.get(camera.id)||''); feedback.setAttribute('role', 'status'); form.append(save, feedback);
    form.addEventListener('input',()=>{cameraSaved.delete(camera.id);feedback.textContent='Ungespeicherte Änderungen';feedback.classList.remove('saved');});
    if(cameraSaved.has(camera.id))feedback.classList.add('saved');
    const needs = el('p', 'small-note'); form.append(needs);
    const dependencies = () => {
      const notes = [];
      if (fields.discordDingClip?.checked && !fields.recordDing?.checked) notes.push('Klingel-Clip benötigt Aufnahme beim Klingeln.');
      if (fields.discordMotionClip.checked && !fields.recordMotion.checked) notes.push('Bewegungsclip benötigt Aufnahme bei Bewegung.');
      if (fields.discordPerson.checked && !fields.personDetection.checked && !fields.faceRecognition.checked) notes.push('Personenmeldung benötigt aktivierte KI.');
      if (fields.discordPerson.checked && !fields.recordDing?.checked && !fields.recordMotion.checked) notes.push('Ohne automatische Aufnahme können nur manuell aufgenommene Clips eine Personenmeldung auslösen.');
      if (fields.discordPersonImage.checked && !fields.discordPerson.checked) notes.push('Personenbild wird nur mit aktiver Personenmeldung gesendet.');
      if (Object.entries(fields).some(([key, value]) => key.startsWith('discord') && value.checked) && !state.settings.discord.enabled) notes.push('Discord-Verbindung unter Discord noch freigeben.');
      if (provider.value !== 'off' && !modelChoices.find(item => item.id === provider.value)?.enabled) notes.push('Gewähltes Modell unter KI-Anbieter noch aktivieren.');
      if (fields.discordSummary.checked && provider.value === 'off') notes.push('Discord-Zusammenfassung benötigt einen ausgewählten KI-Anbieter.');
      if (fields.discordSummaryImage.checked && !fields.discordSummary.checked) notes.push('Szenenbild wird nur zusammen mit aktiver Discord-Zusammenfassung gesendet.');
      if(Number(cooldown.value)>Number(duration.value))notes.push(`Zwischen Aufnahmestarts liegen mindestens ${cooldown.value} Sekunden. Bewegungen nach Clipende können in diese Pause fallen.`);
      needs.textContent = notes.join(' ');
    };
    form.addEventListener('change', dependencies); dependencies();
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      const profile = { ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.checked])), recordingSeconds:Number(duration.value),recordingCooldownSeconds:Number(cooldown.value),summaryProvider: provider.value, sceneContext: context.value.trim() };
      const ok = await window.tw.action('/api/camera-settings', { cameraId: camera.id, profile });
      if(ok)cameraSaved.set(camera.id,`✓ Gespeichert um ${new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`);
      feedback.textContent = ok ? cameraSaved.get(camera.id) : 'Nicht gespeichert – Hinweis oben beachten.';feedback.classList.toggle('saved',ok);
      save.disabled = false;
      if (ok) profilesSignature = '';
    };
    container.append(form);
  }
}
