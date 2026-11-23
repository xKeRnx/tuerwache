(() => {
  const el = window.tw.element, list = document.getElementById('people-list'), form = document.getElementById('face-form'), name = document.getElementById('face-name'), input = document.getElementById('face-image'), feedback = document.getElementById('face-upload-status');
  const worker = el('p', 'small-note face-worker-status'); worker.setAttribute('role', 'status'); document.getElementById('people').querySelector('.face-section-heading').after(worker);
  let signature = '', personId = '', uploading = false, currentDialog = null;
  const dialog = el('dialog', 'model-dialog face-template-dialog'); dialog.setAttribute('aria-labelledby', 'face-template-title');
  const header = el('div', 'model-dialog-header'), title = el('h2'), close = el('button', 'model-dialog-close', '×'); title.id = 'face-template-title'; close.type = 'button'; close.setAttribute('aria-label', 'Schließen'); close.onclick = () => dialog.close(); header.append(title, close);
  const content = el('div', 'face-template-content'), actions = el('div', 'model-dialog-footer'); dialog.append(header, content, actions); document.body.append(dialog);
  const people = () => window.tw.getState()?.ai?.people || [];
  function resetTarget() { personId = ''; name.readOnly = false; form.reset(); feedback.textContent = ''; }
  document.getElementById('face-target-reset').onclick = () => { if (!uploading) resetTarget(); };
  function addPhotos(person) { personId = person.id; name.value = person.name; name.readOnly = true; input.value = ''; feedback.textContent = `Weitere Fotos für ${person.name} auswählen.`; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus(); }
  function dialogButton(label, fn, primary = false) { const button = el('button', primary ? 'button primary-button' : 'button', label); button.type = 'button'; button.onclick = fn; actions.append(button); return button; }
  function showTemplates(id) {
    const person = people().find(person => person.id === id); if (!person) { dialog.close(); return; }
    currentDialog = { kind: 'templates', id }; title.textContent = 'Gesichtsvorlagen'; content.replaceChildren(); actions.replaceChildren();
    const heading = el('strong', '', person.name); heading.dataset.i18nSkip = ''; content.append(heading, el('p', 'small-note', 'Gespeichert sind Merkmalsvektoren, keine Originalfotos. Eine zusätzliche Vorlage ersetzt die bisherigen Vorlagen nicht.'));
    for (const [index, template] of (person.templates || []).entries()) {
      const row = el('div', 'management-row'), caption = el('div'); caption.append(el('span', '', `Vorlage ${index + 1}`), el('small', 'muted', template.at ? new Date(template.at).toLocaleString(window.tuerwacheI18n?.locale || 'de-DE') : 'Übernommene Vorlage'));
      const remove = el('button', 'text-button danger', 'Vorlage entfernen'); remove.type = 'button'; remove.disabled = person.templateCount <= 1; remove.title = remove.disabled ? 'Mindestens eine Vorlage bleibt erhalten. Zum vollständigen Löschen Person vergessen verwenden.' : '';
      remove.onclick = () => confirmRemoval(person, template.id); row.append(caption, remove); content.append(row);
    }
    dialogButton('Schließen', () => dialog.close()); dialogButton('Fotos hinzufügen', () => { dialog.close(); addPhotos(person); }, true);
    if (!dialog.open) dialog.showModal();
  }
  function confirmRemoval(person, templateId) {
    currentDialog = { kind: 'remove', id: person.id }; title.textContent = templateId ? 'Gesichtsvorlage entfernen?' : 'Person vergessen?'; content.replaceChildren(); actions.replaceChildren();
    const caption = el('strong', '', person.name); caption.dataset.i18nSkip = ''; content.append(caption, el('p', 'small-note', templateId ? 'Nur diese Referenzvorlage wird entfernt. Automatische Namenszuordnungen müssen anschließend erneut geprüft werden.' : 'Alle Gesichtsvorlagen dieser Person und lokale Namenszuordnungen werden entfernt. Videos und bereits versandte Nachrichten bleiben erhalten.'));
    dialogButton('Abbrechen', () => templateId ? showTemplates(person.id) : dialog.close());
    const remove = dialogButton(templateId ? 'Vorlage entfernen' : 'Person vergessen', async () => {
      remove.disabled = true;
      try { const ok = await window.tw.action(templateId ? '/api/faces/templates/remove' : '/api/faces/remove', templateId ? { personId: person.id, templateId } : { id: person.id }); if (ok) { if (templateId) showTemplates(person.id); else dialog.close(); } } finally { remove.disabled = false; }
    }); remove.classList.add('danger'); if (!dialog.open) dialog.showModal();
  }
  dialog.onclose = () => { currentDialog = null; };
  function render(state) {
    if (!state?.user || state.user.role !== 'admin') { list.replaceChildren(); signature = ''; if (dialog.open) dialog.close(); if (!uploading) resetTarget(); return; }
    worker.textContent = ({ ready: 'Python-Worker bereit · Modelle bleiben für weitere Auswertungen geladen.', starting: 'Python-Worker startet …', error: 'Python-Worker unterbrochen · startet beim nächsten Auftrag neu.', stopped: 'Python-Worker startet bei der ersten lokalen Auswertung.' })[state.ai.worker?.status || 'stopped'];
    const next = JSON.stringify(state.ai.people); if (next === signature) return; signature = next; list.replaceChildren();
    let options = document.getElementById('known-face-names'); if (!options) { options = el('datalist'); options.id = 'known-face-names'; form.append(options); } options.replaceChildren(); for (const person of state.ai.people) { const option = el('option'); option.value = person.name; options.append(option); }
    if (!state.ai.people.length) list.append(el('p', 'small-note', 'Noch keine bekannten Gesichter angelegt.'));
    for (const person of state.ai.people) {
      const row = el('div', 'management-row face-person-row'), info = el('div', 'face-person-info'), heading = el('strong', '', person.name); heading.dataset.i18nSkip = '';
      info.append(heading, el('span', 'badge neutral', `${person.templateCount} / 12 Vorlagen`));
      if (state.arcFaceConfigured) info.append(el('span', 'badge neutral', `ArcFace · ${person.arcFaceTemplateCount || 0} / ${person.templateCount}`));
      const controls = el('div', 'face-library-actions'), add = el('button', 'button', 'Fotos hinzufügen'), templates = el('button', 'text-button', 'Vorlagen verwalten'), forget = el('button', 'text-button danger', 'Person vergessen');
      for (const button of [add, templates, forget]) button.type = 'button';
      add.disabled = person.templateCount >= 12; add.onclick = () => addPhotos(person); templates.onclick = () => showTemplates(person.id); forget.onclick = () => confirmRemoval(person); controls.append(add, templates, forget); row.append(info, controls); list.append(row);
    }
    if (dialog.open && currentDialog?.kind === 'templates') showTemplates(currentDialog.id);
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (uploading) return;
    const files = [...input.files]; if (!files.length) return;
    if (files.length > 12 || files.some(file => file.size > 4 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { feedback.textContent = 'Bis zu 12 JPEG-, PNG- oder WebP-Fotos mit jeweils höchstens 4 MB auswählen.'; return; }
    const targetId = personId, targetName = name.value.trim(), userId = window.tw.getState()?.user?.id; uploading = true;
    const controls = [...form.querySelectorAll('input,button')]; controls.forEach(control => { control.disabled = true; });
    let learned = 0, failed = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (!userId || window.tw.getState()?.user?.id !== userId) { failed += files.length - index; break; }
        feedback.textContent = `Foto ${index + 1} von ${files.length} wird eingelernt …`;
        try {
          const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
          const before = people().map(person => [person.templateCount, person.arcFaceTemplateCount || 0]);
          const ok = await window.tw.action('/api/faces/add', { ...(targetId ? { personId: targetId } : { name: targetName }), image });
          if (!ok) failed++;
          else if (JSON.stringify(before) !== JSON.stringify(people().map(person => [person.templateCount, person.arcFaceTemplateCount || 0]))) learned++;
        } catch { failed++; }
      }
      input.value = ''; feedback.textContent = `${learned} neue Vorlagen gespeichert. ${failed} Fotos fehlgeschlagen. Identische Fotos werden nicht doppelt gespeichert.`;
    } finally { uploading = false; controls.forEach(control => { control.disabled = false; }); name.readOnly = Boolean(personId); }
  };
  window.addEventListener('tw-state', ({ detail }) => render(detail)); render(window.tw.getState());
})();
