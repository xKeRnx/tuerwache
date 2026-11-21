(() => {
  const byId = id => document.getElementById('network-' + id);
  const form = byId('form'), address = byId('address'), name = byId('name');
  const username = byId('login'), password = byId('password'), profile = byId('profile');
  const results = byId('found'), list = byId('list'), notice = byId('notice');
  const t = (de, en) => document.documentElement.lang === 'en' ? en : de;
  const add = document.getElementById('camera-add'), dialog = document.getElementById('camera-add-dialog');
  const choices = document.getElementById('camera-add-types'), title = document.getElementById('camera-add-title');
  const ring = document.getElementById('camera-add-ring'), ringName = document.getElementById('camera-ring-name');
  const ringNotice = document.getElementById('camera-ring-notice'), close = document.getElementById('camera-add-close');
  const back = [...dialog.querySelectorAll('[data-camera-back]')];
  let kind = '', discovered = [], busy = false, signature = '';

  function option(value, text) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    return node;
  }
  function clearProfiles() {
    profile.replaceChildren(option('', t('Zuerst Videoprofile laden', 'Load video profiles first')));
  }
  function mode() {
    const onvif = kind === 'onvif';
    byId('discovery').hidden = byId('profile-field').hidden = !onvif;
    profile.disabled = !onvif;
    byId('address-label').textContent = onvif ? t('ONVIF-Dienstadresse', 'ONVIF service address') : t('RTSP-Adresse', 'RTSP address');
    address.placeholder = onvif ? 'http://192.168.1.20/onvif/device_service' : 'rtsp://192.168.1.20:554/stream1';
    clearProfiles();
  }
  function show(type = '') {
    kind = type;
    choices.hidden = Boolean(kind);
    ring.hidden = kind !== 'ring';
    form.hidden = kind !== 'onvif' && kind !== 'rtsp';
    const titles = { ring: t('Ring-Konto hinzufügen', 'Add Ring account'), onvif: t('ONVIF-Kamera hinzufügen', 'Add ONVIF camera'), rtsp: t('RTSP-Kamera hinzufügen', 'Add RTSP camera') };
    title.textContent = titles[kind] || t('Kamera hinzufügen', 'Add camera');
    ring.reset(); ringNotice.textContent = '';
    form.reset(); notice.textContent = ''; mode();
    discovered = []; results.replaceChildren();
    results.hidden = byId('found-label').hidden = true;
    byId('options').open = false;
    dialog.scrollTop = 0;
    if (dialog.open) (kind === 'ring' ? ringName : kind === 'rtsp' ? name : title).focus();
  }
  async function request(action, data) {
    const response = await fetch('/api/network-cameras/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': window.tw.getState()?.csrf || '' },
      body: JSON.stringify(data),
    });
    const json = await response.json();
    if (!response.ok) throw Error(json.error);
    return json;
  }
  async function run(button, task, status = notice) {
    if (busy) return;
    busy = button.disabled = true;
    if (dialog.open) for (const control of [close, ...back]) control.disabled = true;
    status.textContent = t('Wird ausgeführt …', 'Working…');
    try { status.textContent = (await task()) || ''; }
    catch (error) { status.textContent = error.message || t('Aktion fehlgeschlagen.', 'Action failed.'); }
    finally {
      busy = button.disabled = false;
      for (const control of [close, ...back]) control.disabled = false;
    }
  }
  const credentials = () => ({ address: address.value.trim(), username: username.value, password: password.value });

  add.onclick = () => { show(); dialog.showModal(); title.focus(); };
  close.onclick = () => dialog.close();
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.onclose = () => show();
  for (const button of back) button.onclick = () => show();
  for (const choice of choices.querySelectorAll('[data-camera-kind]')) choice.onclick = () => show(choice.dataset.cameraKind);
  ring.onsubmit = event => {
    event.preventDefault();
    run(event.submitter, async () => {
      const accounts = window.tw.getState()?.ringConnections || [];
      const primary = accounts.length === 1 && accounts[0].id === 'primary' && accounts[0].phase === 'disconnected' && !accounts[0].hasSavedSession;
      const result = await window.tw.action('/api/ring/accounts/save', { ...(primary ? { id: 'primary' } : {}), name: ringName.value.trim() });
      if (!result?.id) throw Error(t('Das Ring-Konto konnte nicht vorbereitet werden.', 'Could not prepare the Ring account.'));
      dialog.close();
      const select = document.getElementById('ring-account');
      select.value = result.id;
      select.dispatchEvent(new Event('change'));
      document.getElementById('email').focus();
    }, ringNotice);
  };
  for (const input of [address, username, password]) input.addEventListener('input', clearProfiles);
  byId('scan').onclick = event => run(event.currentTarget, async () => {
    const { cameras } = await request('scan', {});
    discovered = cameras;
    results.replaceChildren(option('', t('Kamera auswählen', 'Choose camera')),
      ...cameras.map((camera, index) => option(String(index), camera.name + ' · ' + new URL(camera.address).host)));
    results.hidden = byId('found-label').hidden = !cameras.length;
    return cameras.length ? '' : t('Keine Kamera gefunden. Gib die ONVIF-Adresse ein oder wähle über „Zurück“ RTSP.',
      'No camera found. Enter an ONVIF address or go back and choose RTSP.');
  });
  results.onchange = () => {
    if (results.value === '') return;
    const camera = discovered[Number(results.value)];
    address.value = camera.address;
    if (!name.value) name.value = camera.name;
    clearProfiles();
    username.focus();
  };
  byId('profiles').onclick = event => run(event.currentTarget, async () => {
    if (!address.reportValidity()) return;
    const current = credentials();
    const { profiles } = await request('profiles', current);
    if (kind !== 'onvif' || JSON.stringify(current) !== JSON.stringify(credentials())) return;
    profile.replaceChildren(...profiles.map(item => option(item.token, [item.name, item.encoding].filter(Boolean).join(' · '))));
    const h264 = profiles.find(item => item.encoding === 'H264');
    if (h264) profile.value = h264.token;
    profile.focus();
  });
  form.onsubmit = event => {
    event.preventDefault();
    run(event.submitter, async () => {
      await request('add', { kind, name: name.value, ...credentials(), profile: profile.value,
        preRoll: Number(byId('preroll').value), motion: byId('motion').checked, convert: byId('convert').checked,
        motionAddress: byId('motion-address').value.trim(),
        monitoring: byId('enable').checked });
      dialog.close();
      await window.tw.refresh();
      window.tw.feedback(t('Kamera hinzugefügt.', 'Camera added.'));
      add.focus();
    });
  };

  function render(cameras) {
    const { element } = window.tw;
    const stateLabels = {
      online: t('Online', 'Online'), connecting: t('Warte auf Videostream', 'Waiting for video stream'),
      paused: t('Pausiert', 'Paused'), credentials: t('Zugangsdaten nicht verfügbar', 'Credentials unavailable'),
      limited: t('Limit aktiver Streams erreicht', 'Active stream limit reached'),
    };
    byId('empty').hidden = Boolean(cameras.length);
    list.replaceChildren(...cameras.map(camera => {
      const box = element('details', 'network-camera-row');
      const header = element('summary', 'network-camera-summary');
      header.append(element('strong', '', camera.name), element('span', 'badge neutral', camera.kind.toUpperCase() + ' · ' + stateLabels[camera.status]));
      const edit = element('form', 'network-camera-edit'), rename = element('input'), buffer = element('select');
      rename.value = camera.name; rename.required = true; rename.maxLength = 80;
      for (const seconds of [0, 5, 10, 15]) buffer.append(option(String(seconds),
        seconds ? seconds + t(' Sekunden', ' seconds') : t('Aus', 'Off')));
      buffer.value = String(camera.preRoll);
      const nameLabel = element('label', '', t('Kameraname', 'Camera name'));
      const durationLabel = element('label', '', t('Voraufnahme', 'Pre-recording'));
      nameLabel.append(rename); durationLabel.append(buffer);
      const actions = element('div', 'connection-actions');
      const save = element('button', 'button primary-button', t('Speichern', 'Save')); save.type = 'submit';
      const remove = element('button', 'text-button danger', t('Verbindung entfernen', 'Remove connection')); remove.type = 'button';
      const result = element('p', 'small-note'); result.setAttribute('role', 'status');
      const refresh = async () => { box.open = false; await window.tw.refresh(); };
      edit.onsubmit = event => { event.preventDefault(); run(save, async () => {
        await request('update', { id: camera.id, name: rename.value, preRoll: Number(buffer.value) }); await refresh();
      }, result); };
      remove.onclick = () => {
        if (window.confirm(t('Verbindung entfernen? Gespeicherte Clips bleiben erhalten.', 'Remove the connection? Saved clips will be kept.'))) {
          run(remove, async () => { await request('remove', { id: camera.id }); await refresh(); }, result);
        }
      };
      actions.append(save, remove); edit.append(nameLabel, durationLabel, actions, result); box.append(header, edit);
      return box;
    }));
  }
  window.addEventListener('tw-state', event => {
    if (event.detail.user?.role !== 'admin') { if (dialog.open) dialog.close(); signature = ''; list.replaceChildren(); return; }
    const cameras = event.detail.networkCameras || [];
    const next = JSON.stringify([document.documentElement.lang, cameras]);
    if (next === signature || list.querySelector('details[open]')) return;
    signature = next; render(cameras);
  });
  window.addEventListener('tw-route', event => { if (event.detail !== '/connection' && dialog.open) dialog.close(); });
})();
