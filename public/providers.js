(() => {
  const el = window.tw.element, root = document.getElementById('summary-settings'), list = document.getElementById('model-list'), managerStatus = document.getElementById('model-manager-status');
  const limitForm = document.getElementById('model-limit-form'), limit = document.getElementById('model-limit'), usage = document.getElementById('model-usage');
  let state, signature = '', editing = null, checking = new Set();
  const dialog = el('dialog', 'model-dialog'); dialog.setAttribute('aria-labelledby', 'model-dialog-title');
  const form = el('form', 'model-edit-form'), header = el('div', 'model-dialog-header'), title = el('h2'); title.id = 'model-dialog-title';
  const dismiss = el('button', 'model-dialog-close', '×'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Schließen'); dismiss.onclick = () => dialog.close(); header.append(title, dismiss); form.append(header);
  const fields = el('div', 'model-dialog-fields'); form.append(fields);
  function field(caption, input, full = false) { const label = el('label', full ? 'model-field-wide' : '', caption); label.append(input); fields.append(label); return input; }
  const name = field('Bezeichnung (optional)', el('input'), true); name.maxLength = 80; name.placeholder = 'Zum Beispiel: Haustür lokal'; name.autocomplete = 'off'; name.name = 'ai-display-name';
  const provider = field('Anbieter', el('select')); provider.required = true;
  const model = field('Modell mit Bildunterstützung', el('input')); model.required = true; model.maxLength = 160; model.name = 'ai-model-name'; model.autocomplete = 'off'; model.placeholder = 'Exakten Modellnamen eingeben'; model.setAttribute('list', 'managed-model-names');
  const modelNames = el('datalist'); modelNames.id = 'managed-model-names'; fields.append(modelNames);
  const url = field('API-Basisadresse', el('input'), true); url.type = 'url'; url.required = true; url.name = 'ai-endpoint'; url.autocomplete = 'off';
  const key = field('API-Schlüssel', el('input'), true); key.type = 'password'; key.autocomplete = 'new-password'; key.name = 'ai-provider-secret'; key.maxLength = 2048; key.placeholder = 'Leer lassen = gespeicherten Schlüssel behalten';
  const keyNote = el('p', 'small-note model-field-wide'); fields.append(keyNote);
  const clearLabel = el('label', 'model-field-wide model-key-clear'), clearKey = el('input'); clearKey.type = 'checkbox'; clearLabel.append(clearKey, el('span', '', 'Gespeicherten Schlüssel beim Speichern entfernen')); fields.append(clearLabel);
  const enabledLabel = el('label', 'toggle-row model-field-wide'), enabled = el('input'); enabled.type = 'checkbox'; enabled.setAttribute('role', 'switch'); enabledLabel.append(el('span', '', 'Für Kameras verfügbar'), enabled); fields.append(enabledLabel);
  const infoNote = el('p', 'small-note model-field-wide'); fields.append(infoNote);
  const docs = el('a', 'text-button model-field-wide', 'Dokumentation und unterstützte Modelle →'); docs.target = '_blank'; docs.rel = 'noopener noreferrer'; fields.append(docs);
  const footer = el('div', 'model-dialog-footer'), cancel = el('button', 'button', 'Abbrechen'), save = el('button', 'button primary-button', 'Speichern'); cancel.type = 'button'; cancel.onclick = () => dialog.close(); save.type = 'submit'; footer.append(cancel, save); form.append(footer);
  const editorStatus = el('p', 'small-note model-editor-status'); editorStatus.setAttribute('role', 'status'); form.append(editorStatus); dialog.append(form); document.body.append(dialog);
  const catalog = () => state?.summaryService?.providerCatalog || [];
  const models = () => state?.summaryService?.modelProfiles || [];
  const selectedInfo = () => catalog().find(item => item.id === provider.value);
  function providerChanged() {
    const info = selectedInfo(); if (!info) return;
    const sameProvider = editing?.provider === info.id;
    url.value = sameProvider ? editing.baseUrl || info.baseUrl : info.baseUrl; url.readOnly = !info.customUrl;
    key.value = ''; clearKey.checked = false; clearLabel.hidden = !sameProvider || !editing.keySet;
    key.parentElement.hidden = info.id === 'ollama';
    keyNote.textContent = sameProvider && editing.keySet ? 'API-Schlüssel gespeichert; er wird nie zurück an den Browser übertragen.' : info.keyRequired ? 'Noch kein API-Schlüssel gespeichert.' : 'Kein API-Schlüssel erforderlich, sofern dein lokaler Modellserver keine Anmeldung verlangt.';
    infoNote.textContent = info.local ? 'Lokaler Modellserver: localhost oder private IP-Adresse. Ein Modell mit Bildunterstützung muss dort installiert sein. Die Modellinstallation erfolgt außerhalb von Türwache.' : 'Cloud-Modell: Ausgewählte Kamerabilder und Ortsbeschreibung werden an diesen Anbieter übertragen. Eigener API-Schlüssel erforderlich; Nutzung kann kostenpflichtig sein.';
    docs.href = info.docs; modelNames.replaceChildren();
    const status = state.summaryService.providerStatus?.[editing?.id || info.id]; for (const item of status?.models || []) { const option = el('option'); option.value = item.name; modelNames.append(option); }
  }
  function openEditor(item) {
    editing = item || null; form.reset(); editorStatus.textContent = ''; title.textContent = item ? 'Modell bearbeiten' : 'Modell hinzufügen';
    provider.replaceChildren();
    for (const local of [true, false]) { const group = el('optgroup'); group.label = local ? 'Lokal' : 'Cloud'; for (const info of catalog().filter(info => info.local === local)) { const option = el('option', '', info.name); option.value = info.id; group.append(option); } provider.append(group); }
    provider.value = item?.provider || 'ollama'; provider.disabled = Boolean(item);
    name.value = item?.name || ''; model.value = item?.model || ''; enabled.checked = item?.enabled ?? true; providerChanged(); dialog.showModal(); name.focus();
  }
  provider.onchange = providerChanged;
  clearKey.onchange = () => { if (clearKey.checked) enabled.checked = false; };
  dialog.onclose = () => { key.value = ''; editing = null; };
  document.getElementById('model-add').onclick = () => openEditor();
  form.onsubmit = async event => {
    event.preventDefault(); const info = selectedInfo(); if (!info) return; save.disabled = true; editorStatus.textContent = 'Wird gespeichert …';
    const input = { ...(editing ? { id: editing.id } : {}), provider: info.id, name: name.value.trim() || `${info.name} · ${model.value.trim()}`.slice(0, 80), model: model.value.trim(), baseUrl: url.value.trim(), apiKey: key.value, enabled: enabled.checked, clearKey: clearKey.checked }; key.value = '';
    try { const ok = await window.tw.action('/api/models/save', input); if (ok) { dialog.close(); managerStatus.textContent = 'KI-Modell gespeichert.'; render(window.tw.getState(), true); } else editorStatus.textContent = 'Nicht gespeichert – Hinweis oben beachten.'; } finally { save.disabled = false; }
  };
  async function checkModel(item) {
    checking.add(item.id); render(state, true);
    try { await window.tw.action('/api/models/check', { id: item.id }); } finally { checking.delete(item.id); render(window.tw.getState(), true); }
  }
  const removeDialog = el('dialog', 'model-dialog model-remove-dialog'), removeHeading = el('h2', '', 'Modell entfernen?'), removeText = el('p'), removeActions = el('div', 'model-dialog-footer'), removeCancel = el('button', 'button', 'Abbrechen'), removeConfirm = el('button', 'button danger', 'Modell entfernen');
  removeHeading.id = 'model-remove-title'; removeDialog.setAttribute('aria-labelledby', removeHeading.id); removeText.dataset.i18nSkip = '';
  const removeHelp = el('p', 'small-note', 'Die Konfiguration und der gespeicherte Schlüssel werden entfernt. Installierte Modelle und vorhandene Clips bleiben erhalten.');
  removeActions.append(removeCancel, removeConfirm); removeDialog.append(removeHeading, removeText, removeHelp, removeActions); document.body.append(removeDialog);
  let removing = null;
  function removeModel(item) { removing = item; removeText.textContent = item.name; removeDialog.showModal(); removeCancel.focus(); }
  removeCancel.type = removeConfirm.type = 'button'; removeCancel.onclick = () => removeDialog.close(); removeDialog.onclose = () => { removing = null; };
  removeConfirm.onclick = async () => { if (!removing) return; removeConfirm.disabled = true; try { if (await window.tw.action('/api/models/remove', { id: removing.id })) { removeDialog.close(); managerStatus.textContent = 'KI-Modell entfernt.'; render(window.tw.getState(), true); } } finally { removeConfirm.disabled = false; } };
  limitForm.onsubmit = async event => {
    event.preventDefault(); const button = limitForm.querySelector('button'); button.disabled = true;
    try { const ok = await window.tw.action('/api/settings', { summaries: { openaiDailyLimit: Number(limit.value) } }); managerStatus.textContent = ok ? 'Cloud-Tageslimit gespeichert.' : 'Nicht gespeichert – Hinweis oben beachten.'; } finally { button.disabled = false; }
  };
  function render(next, force = false) {
    state = next; if (!state?.user || state.user.role !== 'admin') { if (dialog.open) dialog.close(); if (removeDialog.open) removeDialog.close(); list.replaceChildren(); signature = ''; return; }
    const service = state.summaryService, nextSignature = JSON.stringify([service.modelProfiles, service.providerStatus, state.cameras]);
    if (!limitForm.contains(document.activeElement)) limit.value = String(state.settings.summaries.openaiDailyLimit);
    const cloud = service.cloudUsage; usage.textContent = cloud ? `${cloud.requests} von ${cloud.limit} Cloud-Anfragen heute (UTC).` : '';
    if (!force && signature === nextSignature) return; signature = nextSignature; list.replaceChildren();
    if (!models().length) { const empty = el('div', 'model-empty'); empty.append(el('h3', '', 'Noch keine KI-Modelle'), el('p', '', 'Füge ein lokales oder ein Cloud-Modell hinzu. Anschließend kannst du es einer Kamera zuordnen.')); list.append(empty); return; }
    const table = el('table', 'models-table'), head = el('thead'), headings = el('tr');
    for (const label of ['Modell', 'Anbieter', 'Verwendet von', 'Status', 'Aktionen']) { const th = el('th', '', label); th.scope = 'col'; headings.append(th); } head.append(headings); table.append(head);
    const body = el('tbody');
    for (const item of models()) {
      const row = el('tr'), info = catalog().find(info => info.id === item.provider);
      function cell(label) { const td = el('td'); td.dataset.label = label; row.append(td); return td; }
      const identity = cell('Modell'), modelName = el('strong', '', item.name); modelName.dataset.i18nSkip = ''; identity.append(modelName, el('code', '', item.model));
      const status = service.providerStatus?.[item.id];
      if (checking.has(item.id)) identity.append(el('span', 'model-check-status', 'Verbindung wird geprüft …'));
      else if (status) identity.append(el('span', `model-check-status ${status.error ? 'model-check-error' : ''}`, status.error || (status.selectedVision ? 'Verbunden · Bildmodell bestätigt' : 'Verbunden · Bildunterstützung beim Anbieter prüfen')));
      const providerCell = cell('Anbieter'); providerCell.append(el('span', '', info?.name || item.provider), el('small', '', info?.local ? 'Lokal' : 'Cloud'));
      const cameras = state.cameras.filter(camera => camera.features?.summaryProvider === item.id);
      const used = cell('Verwendet von'), names = el('span', '', cameras.map(camera => camera.name).join(', ')); names.dataset.i18nSkip = ''; used.append(cameras.length ? names : el('span', 'model-unused', 'Noch keiner Kamera'));
      cell('Status').append(el('span', `badge ${item.enabled ? '' : 'neutral'}`, item.enabled ? 'Verfügbar' : 'Deaktiviert'));
      const actions = cell('Aktionen'), group = el('div', 'model-row-actions');
      for (const [label, action] of [['Bearbeiten', () => openEditor(item)], ['Prüfen', () => checkModel(item)], ['Entfernen', () => removeModel(item)]]) { const button = el('button', label === 'Entfernen' ? 'text-button danger' : 'text-button', label); button.type = 'button'; button.onclick = action; if (label === 'Prüfen') button.disabled = checking.has(item.id); if (label === 'Entfernen' && cameras.length) { button.disabled = true; button.title = 'Zuerst im Kamera-Profil ein anderes Modell oder Aus wählen.'; } group.append(button); } actions.append(group); body.append(row);
    }
    table.append(body); list.append(table);
  }
  window.addEventListener('tw-state', ({ detail }) => render(detail)); render(window.tw.getState());

  const workerField = name => document.getElementById('face-worker-' + name);
  const workerPanel = workerField('settings'), workerForm = workerField('form');
  if (!workerForm) return;
  const workerMode = workerField('mode');
  const workerUrl = workerField('url'), workerToken = workerField('token'), workerEnabled = workerField('enabled'), workerArcFace = workerField('arcface');
  const workerSave = workerField('save'), workerCheck = workerField('check'), workerClear = workerField('clear'), workerStatus = workerField('status');
  let workerConfig, workerDirty = false, workerPending = false;
  function renderWorkerMode() {
    const external = workerMode.value === 'external';
    workerField('external').hidden = !external;
    workerField('local-note').hidden = external;
    workerUrl.disabled = workerToken.disabled = workerPending || !external;
    workerClear.hidden = !external || workerConfig?.mode === 'local' || !workerConfig?.tokenSet;
  }
  function renderWorker(next, force = false) {
    const config = next?.settings?.faceWorker;
    workerPanel.hidden = !config;
    if (!config) { workerToken.value = ''; workerDirty = false; workerConfig = null; return; }
    if (!force && (workerDirty || JSON.stringify(config) === JSON.stringify(workerConfig))) return;
    workerConfig = config;
    workerMode.value = config.mode ?? 'external';
    workerUrl.value = config.url;
    workerToken.value = '';
    workerEnabled.checked = config.enabled;
    workerArcFace.checked = config.arcface;
    renderWorkerMode();
    workerField('source').hidden = !config.fromEnvironment;
    workerField('badge').textContent = config.enabled ? 'Freigegeben' : config.tokenSet ? 'Deaktiviert' : 'Noch nicht eingerichtet';
    workerField('token-note').textContent = config.tokenSet ? 'Leer lassen, um den gespeicherten Token zu behalten.' : 'Verwende denselben Token wie auf dem Worker.';
  }
  function workerInput() {
    const mode = workerMode.value;
    return { mode, enabled: workerEnabled.checked, arcface: workerArcFace.checked, ...(mode === 'external' && { url: workerUrl.value.trim(), token: workerToken.value }) };
  }
  async function workerAction(path, input, message, commit = false) {
    if (workerPending) return;
    workerPending = true;
    for (const control of workerForm.elements) control.disabled = true;
    workerStatus.textContent = path.endsWith('/check') ? 'Verbindung wird geprüft …' : 'Wird gespeichert …';
    try {
      const ok = await window.tw.action(path, input);
      workerStatus.textContent = ok ? message : 'Aktion fehlgeschlagen. Details stehen in der Meldung.';
      if (ok && commit) { workerDirty = false; renderWorker(window.tw.getState(), true); }
    } finally {
      for (const control of workerForm.elements) control.disabled = false;
      workerPending = false;
      renderWorkerMode();
    }
  }
  workerForm.addEventListener('input', () => { workerDirty = true; workerStatus.textContent = ''; });
  workerMode.onchange = renderWorkerMode;
  workerForm.onsubmit = event => {
    event.preventDefault();
    workerAction('/api/face-worker/save', workerInput(), 'Worker-Einstellungen gespeichert.', true);
  };
  workerCheck.onclick = () => {
    if (!workerForm.reportValidity()) return;
    workerAction('/api/face-worker/check', workerInput(), workerArcFace.checked ? 'Worker erreichbar. SFace und ArcFace geprüft.' : 'Worker erreichbar. SFace geprüft.');
  };
  workerClear.onclick = () => workerAction('/api/face-worker/save', { clearToken: true }, 'Worker-Token entfernt. Die Verbindung ist deaktiviert.', true);
  window.addEventListener('tw-state', ({ detail }) => renderWorker(detail));
  window.addEventListener('tw-route', ({ detail }) => {
    if (detail === '/ai') return;
    workerToken.value = '';
    if (!workerPending) {
      workerDirty = false;
      workerStatus.textContent = '';
      renderWorker(window.tw.getState(), true);
    }
  });
  renderWorker(window.tw.getState());
})();
