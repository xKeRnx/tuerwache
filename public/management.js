(() => {
  const { action, element: el, getState } = window.tw;
  const byId = id => document.getElementById(id);
  const actions = { events: 'Ereignisse sehen', clips: 'Clips ansehen', live: 'Livebild öffnen', export: 'Clips exportieren', push: 'Push empfangen', capture: 'Aufnahme starten', analyze: 'KI auswerten', review: 'KI-Ergebnisse bewerten', protect: 'Clips vor automatischer Löschung schützen', delete: 'Clips löschen', configure: 'Aufnahme-Einstellungen ändern' };
  const statuses = { online: 'Online', offline: 'Offline', disconnected: 'Ring-Verbindung getrennt', paused: 'Pausiert' };
  const statusRows = document.querySelector('[data-page="/sites"]');
  statusRows.classList.add('site-overview');
  const rolesPanel = el('section', 'role-manager');
  byId('user-list').after(rolesPanel);
  const initialScope = el('input'); initialScope.type = 'checkbox'; initialScope.defaultChecked = true; initialScope.id = 'user-no-cameras';
  byId('user-role').after(field('Zunächst keine Kameras freigeben', initialScope, 'choice'));
  byId('users').querySelector('.description').textContent = 'Lege Rollen fest und gib jedem Benutzer passende Standorte oder einzelne Kameras frei.';

  function button(text, click, classes = 'button') {
    const node = el('button', classes, text); node.type = 'button'; node.onclick = click; return node;
  }
  function input(type, value = '') {
    const node = el('input'); node.type = type;
    if (type === 'checkbox') node.checked = Boolean(value); else node.value = value;
    return node;
  }
  function field(text, control, cls = '') {
    const label = el('label', cls, text); control.setAttribute('aria-label', text); label.append(control); return label;
  }
  function select(options, value) {
    const node = el('select');
    for (const [id, label] of options) { const option = el('option', '', label); option.value = id; node.append(option); }
    if (value !== undefined) node.value = value;
    return node;
  }
  function toggles(choices, selected) {
    const box = el('div', 'rights-grid'), controls = new Map();
    for (const [id, text] of choices) {
      const node = input('checkbox', selected.includes(id)); controls.set(id, node); box.append(field(text, node, 'choice'));
    }
    return { box, value: () => [...controls].filter(([, node]) => node.checked).map(([id]) => id) };
  }
  function editor(title, build, save, wide = false) {
    const dialog = el('dialog', wide ? 'model-dialog management-dialog management-wide' : 'model-dialog management-dialog');
    const form = el('form'), header = el('header', 'model-dialog-header'), content = el('div', 'management-dialog-body');
    const footer = el('footer', 'model-dialog-footer'), heading = el('h2', '', title);
    const submit = el('button', 'button primary-button', 'Speichern');
    const error = el('p', 'management-error');
    error.hidden = true; error.setAttribute('role', 'alert');
    heading.id = 'management-dialog-title'; heading.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', heading.id);
    const close = button('×', () => dialog.close(), 'model-dialog-close');
    close.setAttribute('aria-label', 'Schließen');
    header.append(heading, close);
    const cancel = button('Abbrechen', () => dialog.close());
    submit.type = 'submit';
    footer.append(cancel, submit);
    const value = build(content);
    form.append(header, content, error, footer); dialog.append(form);
    form.onsubmit = async event => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = cancel.disabled = close.disabled = true;
      try {
        if (await save(value())) dialog.close();
        else throw Error(byId('notice')?.textContent || 'Die Änderung konnte nicht gespeichert werden.');
      } catch (failure) {
        error.textContent = failure.message; error.hidden = false;
      } finally { submit.disabled = cancel.disabled = close.disabled = false; }
    };
    dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal(); heading.focus(); return dialog;
  }
  function nameDialog(title, old, save) {
    editor(title, form => {
      const name = input('text', old); name.required = true; name.maxLength = 80;
      form.append(field('Bezeichnung', name)); return () => ({ name: name.value });
    }, save);
  }
  const ringAction = (path, body) => action('/api/ring/accounts/' + path, body);
  byId('ring-rename').onclick = () => {
    const ring = getState()?.ringConnections?.find(item => item.id === byId('ring-account').value);
    if (ring) nameDialog('Ring-Konto umbenennen', ring.name, body => ringAction('save', { id: ring.id, ...body }));
  };
  byId('ring-remove').onclick = () => {
    const id = byId('ring-account').value;
    if (confirm('Ring-Verbindung und deren gespeicherte Anmeldung entfernen? Vorhandene Clips bleiben verfügbar.')) ringAction('remove', { id });
  };

  const actionChoices = state => (state.cameraActions || []).map(id => [id, actions[id]]);
  const roleOptions = state => (state.roles || []).map(({ id, name }) => [id, name]);
  const siteOptions = state => state.sites.map(site => [site.id, site.name]);
  function cameraPermissions(state, saved, isRole) {
    const section = el('section', 'camera-permissions');
    const mode = select([['default', isRole ? 'Alle Kameras' : 'Nach Rolle'], ['selected', 'Nur ausgewählte Standorte und Kameras']], saved?.restricted ? 'selected' : 'default');
    const hint = el('p', 'small-note', isRole ? 'Die Standort- und Kamerarechte können die Standardrechte der Rolle ändern.' : 'Einzelrechte für diesen Benutzer haben Vorrang vor der Rolle.');
    section.append(el('h3', '', 'Kamerazugriff'), field('Geltungsbereich', mode), hint);
    const groups = el('div', 'permission-scope-list'), selections = [];
    const rules = [];
    function scope(parent, title, kind, id, selectable) {
      const row = el('div', `permission-scope-row permission-scope-${kind}`);
      const details = el('details', 'permission-scope-details');
      const summary = el('summary');
      const titleTag = el('span', 'permission-scope-name', title);
      const indicator = el('span', 'permission-scope-action', 'Rechte');
      summary.append(titleTag, indicator);
      details.append(summary);
      const grid = el('div', 'rights-grid permission-actions');
      const existing = (saved?.rules || []).filter(rule => rule.scope === kind && rule.id === id);
      const controls = actionChoices(state).map(([key, label]) => {
        const initial = existing.some(rule => rule.deny.includes(key)) ? 'deny' : existing.some(rule => rule.allow.includes(key)) ? 'allow' : 'inherit';
        const decision = select([['inherit', isRole ? 'Standard' : 'Von Rolle übernehmen'], ['allow', 'Erlauben'], ['deny', 'Sperren']], initial);
        grid.append(field(label, decision));
        return [key, decision];
      });
      details.append(grid);
      if (selectable) {
        const checked = input('checkbox', saved?.[kind === 'site' ? 'sites' : 'cameras']?.includes(id));
        const selection = field('Freigeben', checked, 'permission-select');
        checked.setAttribute('aria-label', `Freigeben · ${title}`);
        selections.push({ kind, id, checked, selection });
        row.append(selection);
      }
      row.append(details); parent.append(row);
      rules.push(() => ({
        scope: kind, id,
        allow: controls.filter(([, decision]) => decision.value === 'allow').map(([key]) => key),
        deny: controls.filter(([, decision]) => decision.value === 'deny').map(([key]) => key),
      }));
    }
    scope(groups, 'Alle Kameras', 'all', undefined, false);
    for (const site of state.sites || []) {
      const group = el('div', 'permission-site');
      scope(group, site.name, 'site', site.id, true);
      for (const camera of site.cameras) scope(group, camera.name, 'camera', camera.id, true);
      groups.append(group);
    }
    const updateMode = () => { for (const { selection } of selections) selection.hidden = mode.value !== 'selected'; };
    mode.onchange = updateMode; updateMode(); section.append(groups);
    return { section, value: () => ({
      restricted: mode.value === 'selected',
      sites: selections.filter(item => item.kind === 'site' && item.checked.checked).map(item => item.id),
      cameras: selections.filter(item => item.kind === 'camera' && item.checked.checked).map(item => item.id),
      rules: rules.map(read => read()).filter(rule => rule.allow.length || rule.deny.length),
    }) };
  }

  function editRole(state, role) {
    editor(role ? `Rolle bearbeiten · ${role.name}` : 'Eigene Rolle anlegen', form => {
      const name = input('text', role?.name || ''); name.required = true; name.maxLength = 80;
      const access = cameraPermissions(state, role?.permissions, true);
      const permissions = toggles(actionChoices(state), role?.actions || []);
      const defaults = el('details', 'permission-defaults');
      defaults.append(el('summary', '', 'Standardrechte der Rolle'), permissions.box);
      form.append(field('Rollenname', name), access.section, defaults);
      return () => ({ id: role?.id, name: name.value, actions: permissions.value(), permissions: access.value() });
    }, value => action('/api/roles/save', value), true);
  }

  function editUser(state, user) {
    editor(`Benutzer bearbeiten · ${user.name}`, form => {
      const name = input('text', user.name); name.required = true; name.minLength = 2; name.maxLength = 60;
      const role = select(roleOptions(state), user.role), password = input('password'); password.minLength = 12; password.maxLength = 256; password.autocomplete = 'new-password';
      const disabled = input('checkbox', user.disabled);
      const access = cameraPermissions(state, user.cameraAccess, false);
      const admin = el('p', 'small-note', 'Administratoren haben Zugriff auf alle Kameras und Einstellungen.');
      const updateRole = () => { access.section.hidden = role.value === 'admin'; admin.hidden = role.value !== 'admin'; };
      role.onchange = updateRole; updateRole();
      const effective = el('details', 'permission-defaults'), result = el('div');
      effective.append(el('summary', '', 'Aktuell wirksame Kamerarechte'), result);
      effective.addEventListener('toggle', async () => {
        if (!effective.open) return;
        result.replaceChildren(el('p', 'small-note', 'Kamerarechte werden geladen …'));
        try {
          const response = await fetch(`/api/users/${user.id}/permissions`);
          if (!response.ok) throw Error();
          const { sites } = await response.json(), visible = sites.flatMap(site => site.cameras.map(camera => [site.name, camera]));
          result.replaceChildren(...visible.map(([siteName, camera]) => el('p', 'small-note', `${camera.name} · ${siteName} — ${camera.permissions.map(id => actions[id]).join(', ')}`)));
          if (!visible.length) result.append(el('p', 'small-note', 'Keine aktiven Kamerarechte.'));
        } catch { result.replaceChildren(el('p', 'small-note', 'Kamerarechte konnten nicht geladen werden.')); }
      });
      const fields = el('div', 'management-account-fields');
      fields.append(field('Benutzername', name), field('Rolle', role));
      const credentials = el('details', 'permission-defaults');
      credentials.append(el('summary', '', 'Passwort und Kontosperre'), field('Neues Passwort (optional)', password), field('Benutzer sperren', disabled, 'choice'));
      form.append(fields, access.section, admin, effective, credentials);
      return () => ({ id: user.id, name: name.value, role: role.value, password: password.value || undefined, disabled: disabled.checked, permissions: access.value() });
    }, value => action('/api/users/update', value), true);
  }

  function editRecording(camera) {
    const profile = getState()?.cameraProfiles?.[camera.id] || {};
    editor(`Aufnahme-Einstellungen · ${camera.name}`, form => {
      const fields = { monitoring: 'Kamera überwachen', recordDing: 'Bei Klingeln aufnehmen', recordMotion: 'Bei Bewegung aufnehmen', extendRecording: 'Aufnahme für weitere Ereignisse verlängern' };
      const boolean = new Map();
      for (const [id, label] of Object.entries(fields)) { const control = input('checkbox', profile[id]); boolean.set(id, control); form.append(field(label, control, 'choice')); }
      const seconds = select([10, 20, 30, 45, 60].map(value => [value, `${value} s`]), profile.recordingSeconds || 10);
      const cooldown = input('number', profile.recordingCooldownSeconds || 60); cooldown.min = '10'; cooldown.max = '3600'; cooldown.required = true;
      form.append(field('Clipdauer', seconds), field('Aufnahmepause in Sekunden', cooldown));
      return () => ({ ...Object.fromEntries([...boolean].map(([key, node]) => [key, node.checked])), recordingSeconds: Number(seconds.value), recordingCooldownSeconds: Number(cooldown.value) });
    }, profile => action('/api/camera-settings', { cameraId: camera.id, profile }));
  }

  function editPrivacy(camera) {
    const state = getState(), previous = state.cameraProfiles?.[camera.id] || camera.features || {};
    editor(`Privatzonen und Gesichtserkennung · ${camera.name}`, form => {
      const faceEngine = select([['local', 'Lokal auf Türwache'], ['network', 'Gesichts-Worker im Heimnetz']], previous.faceEngine || 'local');
      form.append(field('Gesichts-Engine', faceEngine), el('p', 'small-note', state.faceWorkerConfigured ? 'Mit Privatzonen verarbeitet Türwache Gesichter lokal.' : 'Für die Heimnetz-Auswertung zuerst FACE_WORKER_URL und FACE_WORKER_TOKEN auf dem Server setzen.'));
      const canvas = el('canvas', 'privacy-preview'); canvas.width = 640; canvas.height = 360; canvas.setAttribute('aria-label', 'Vorschau der Privatzonen. Zonen lassen sich auch mit den Positionsfeldern einstellen.');
      const ctx = canvas.getContext('2d'), picture = new Image();
      const example = state.events.find(entry => entry.cameraId === camera.id && entry.clip && entry.status === 'ready');
      const rows = el('div', 'zone-rows'); const items = new Map(); let dragStart, activeArea;
      const values = () => [...items.values()].map(read => read());
      function paint() {
        ctx.fillStyle = '#dce5de'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (picture.complete && picture.naturalWidth) ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
        else {
          ctx.fillStyle = '#365849'; ctx.font = '16px sans-serif'; ctx.fillText('Vorschau wird mit dem nächsten Clip verfügbar.', 18, 32);
        }
        for (const zone of [...values(), ...(activeArea ? [activeArea] : [])]) {
          const x = zone.x * canvas.width / 100, y = zone.y * canvas.height / 100;
          const w = zone.width * canvas.width / 100, h = zone.height * canvas.height / 100;
          ctx.fillStyle = 'rgba(0,0,0,.80)'; ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = '#fff'; ctx.strokeRect(x, y, w, h);
        }
      }
      const add = button('Privatzone hinzufügen', () => addZone({ x: 5, y: 5, width: 20, height: 20 }));
      function addZone(zone) {
        if (items.size >= 8) return;
        const row = el('fieldset', 'zone-row'); row.append(el('legend', '', 'Bildbereich in Prozent'));
        const controls = new Map();
        for (const [key, title] of [['x', 'Links'], ['y', 'Oben'], ['width', 'Breite'], ['height', 'Höhe']]) {
          const number = input('number', zone[key]); number.min = ['x', 'y'].includes(key) ? '0' : '1'; number.max = '100'; number.required = true; number.oninput = paint;
          controls.set(key, number); row.append(field(title, number));
        }
        row.append(button('Entfernen', () => { items.delete(row); row.remove(); add.disabled = false; paint(); }, 'text-button danger'));
        items.set(row, () => Object.fromEntries([...controls].map(([key, number]) => [key, Number(number.value)])));
        rows.append(row); add.disabled = items.size >= 8; paint();
      }
      const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [Math.round(Math.min(100, Math.max(0, (event.clientX - rect.left) * 100 / rect.width))), Math.round(Math.min(100, Math.max(0, (event.clientY - rect.top) * 100 / rect.height)))];
      };
      canvas.onpointerdown = event => { if (items.size < 8) { canvas.setPointerCapture(event.pointerId); dragStart = point(event); } };
      canvas.onpointermove = event => {
        if (!dragStart) return;
        const [x, y] = point(event);
        activeArea = { x: Math.min(x, dragStart[0]), y: Math.min(y, dragStart[1]), width: Math.abs(x - dragStart[0]), height: Math.abs(y - dragStart[1]) }; paint();
      };
      canvas.onpointerup = () => { if (activeArea?.width && activeArea.height) addZone(activeArea); dragStart = activeArea = null; paint(); };
      canvas.onpointercancel = () => { dragStart = activeArea = null; paint(); };
      picture.onload = () => { canvas.height = Math.round(640 * picture.naturalHeight / picture.naturalWidth); paint(); };
      if (example) picture.src = `/api/clips/${example.id}/thumbnail`;
      (previous.privacyZones || []).forEach(addZone); paint();
      form.append(el('p', 'small-note', 'Ziehe Rechtecke im Bild oder gib Position und Größe ein. Die Zonen werden in exportierten Clips und weitergeleiteten Bildern schwarz abgedeckt.'), canvas, rows, add);
      return () => ({ faceEngine: faceEngine.value, privacyZones: values() });
    }, profile => action('/api/camera-settings', { cameraId: camera.id, profile }));
  }

  function manageSites(state) {
    const admin = state.user.role === 'admin';
    statusRows.replaceChildren();
    if (admin) {
      const toolbar = el('div', 'site-toolbar');
      toolbar.append(button('Standort hinzufügen', () => nameDialog('Standort anlegen', '', body => action('/api/sites/save', body))));
      statusRows.append(toolbar);
    }
    const visibleSites = (state.sites || []).filter(site => site.id !== 'default' || site.cameras.length);
    for (const site of visibleSites) {
      const section = el('section', 'panel site-panel'), header = el('div', 'panel-top');
      header.append(el('h2', '', site.name));
      if (admin && site.id !== 'default') header.append(button('Umbenennen', () => nameDialog('Standort umbenennen', site.name, body => action('/api/sites/save', { id: site.id, ...body })), 'text-button'));
      section.append(header);
      if (!site.cameras.length) section.append(el('p', 'small-note site-empty', 'Noch keine Kamera zugeordnet.'));
      for (const camera of site.cameras) {
        const row = el('div', 'site-camera'), status = el('div', 'site-camera-status'), toolbar = el('div', 'event-actions');
        const live = camera.status === 'online' && camera.permissions.includes('live');
        status.append(el('strong', '', camera.name), el('span', `badge ${camera.status === 'online' ? '' : 'neutral'}`, statuses[camera.status]));
        if (camera.permissions.includes('events')) status.append(el('span', 'small-note', camera.lastEvent ? `${camera.lastEvent.type === 'ding' ? 'Klingeln' : 'Bewegung'} · ${new Date(camera.lastEvent.at).toLocaleString('de-DE')}` : 'Noch kein Ereignis'));
        if (live) toolbar.append(button('Livebild wählen', () => { window.tw.navigate('/'); const drop = byId('camera-select'); drop.value = camera.id; drop.dispatchEvent(new Event('change')); }));
        if (camera.permissions.includes('configure') && state.cameras.some(item => item.id === camera.id)) toolbar.append(button('Aufnahme einstellen', () => editRecording(camera), 'text-button'));
        if (admin) {
          toolbar.append(button('Privatzonen & KI', () => editPrivacy(camera), 'text-button'));
          if (state.sites.length > 1) toolbar.append(button('Standort wechseln', () => {
            editor(`Standort wechseln · ${camera.name}`, form => {
              const target = select(siteOptions(state), site.id);
              form.append(field('Standort', target));
              return () => ({ cameraId: camera.id, siteId: target.value });
            }, value => action('/api/sites/assign', value));
          }, 'text-button'));
        }
        row.append(status, toolbar); section.append(row);
      }
      statusRows.append(section);
    }
    if (!visibleSites.length) statusRows.append(el('p', 'panel small-note site-empty', 'Für dieses Konto sind noch keine Kameras freigegeben.'));
  }

  function manageUsers(state) {
    const list = byId('user-list'), selector = byId('user-role'), selected = selector.value;
    selector.replaceChildren(...select(roleOptions(state)).options);
    selector.value = state.roles?.some(role => role.id === selected) ? selected : 'viewer';
    list.replaceChildren();
    for (const user of state.users) {
      const row = el('div', 'management-row');
      row.append(el('strong', '', user.name), el('span', 'small-note', [state.roles.find(role => role.id === user.role)?.name, user.disabled ? 'Gesperrt' : user.mfaEnabled ? '2FA aktiv' : '2FA aus'].filter(Boolean).join(' · ')));
      const controls = el('div', 'event-actions');
      controls.append(button('Konto & Rechte', () => editUser(state, user)), button('Sitzungen widerrufen', () => {
        if (confirm(`Alle Sitzungen von ${user.name} abmelden?`)) action('/api/users/update', { id: user.id, revokeSessions: true });
      }, 'text-button'));
      if (user.id !== state.user.id) controls.append(button('Entfernen', () => {
        if (confirm(`Benutzer ${user.name} entfernen?`)) action('/api/users/update', { id: user.id, remove: true });
      }, 'text-button danger'));
      row.append(controls); list.append(row);
    }
    const roleHeader = el('header', 'role-manager-header');
    roleHeader.append(el('h3', '', 'Rollen'), button('Eigene Rolle anlegen', () => editRole(state), 'button role-create'));
    rolesPanel.replaceChildren(roleHeader);
    for (const role of state.roles || []) {
      const row = el('div', 'management-row'); row.append(el('strong', '', role.name));
      if (role.id !== 'admin') row.append(button('Rechte bearbeiten', () => editRole(state, role), 'text-button'));
      else row.append(el('span', 'small-note', 'Vollzugriff'));
      if (!['admin', 'operator', 'viewer'].includes(role.id) && !state.users.some(user => user.role === role.id)) row.append(button('Entfernen', () => {
        if (confirm(`Rolle ${role.name} entfernen?`)) action('/api/roles/remove', { id: role.id });
      }, 'text-button danger'));
      rolesPanel.append(row);
    }
  }

  function quietForm(value) {
    const form = el('form'), enabled = input('checkbox', value.enabled), start = input('time', value.start), end = input('time', value.end), zone = input('text', value.timeZone), ding = input('checkbox', value.allowDing);
    start.required = end.required = zone.required = true;
    const save = el('button', 'button primary-button', 'Ruhezeiten speichern'); save.type = 'submit';
    form.append(field('Ruhezeiten aktivieren', enabled, 'choice'), field('Von', start), field('Bis', end), field('Zeitzone', zone), field('Klingeln darf die Ruhezeit unterbrechen', ding, 'choice'), save);
    form.onsubmit = event => { event.preventDefault(); action('/api/account/quiet-hours', { enabled: enabled.checked, start: start.value, end: end.value, timeZone: zone.value, allowDing: ding.checked }); };
    byId('quiet-hours').replaceChildren(form);
  }

  let siteSignature, userSignature, quietSignature;
  window.addEventListener('tw-state', ({ detail: state }) => {
    if (!state.user) { siteSignature = userSignature = quietSignature = null; statusRows.replaceChildren(); byId('user-list').replaceChildren(); rolesPanel.replaceChildren(); return; }
    const sites = JSON.stringify([state.user.role, state.sites]);
    if (sites !== siteSignature) { siteSignature = sites; manageSites(state); }
    if (state.roles && state.users) {
      const users = JSON.stringify([state.users, state.roles, state.sites?.map(site => [site.id, site.name, site.cameras.map(camera => [camera.id, camera.name])])]);
      if (users !== userSignature) { userSignature = users; manageUsers(state); }
    }
    const quiet = JSON.stringify([state.user.id, state.quietHours]);
    if (state.quietHours && quiet !== quietSignature) { quietSignature = quiet; quietForm(state.quietHours); }
  });
})();
