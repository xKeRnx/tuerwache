(() => {
  let language = 'de';
  try { const saved = localStorage.getItem('tuerwache.language'); if (saved === 'en') language = saved; } catch {}
  const dictionary = window.TUERWACHE_TRANSLATIONS || {};
  const patterns = [
    [/^(\d+) \/ 12 Vorlagen$/, (_, n) => `${n} / 12 templates`],
    [/^Vorlage (\d+)$/, (_, n) => `Template ${n}`],
    [/^Weitere Fotos für (.+) auswählen\.$/, (_, name) => `Select more photos for ${name}.`],
    [/^Foto (\d+) von (\d+) wird eingelernt …$/, (_, n, total) => `Learning photo ${n} of ${total} …`],
    [/^(\d+) neue Vorlagen gespeichert\. (\d+) Fotos fehlgeschlagen\. Identische Fotos werden nicht doppelt gespeichert\.$/, (_, learned, failed) => `${learned} new templates saved. ${failed} photos failed. Identical photos are not stored twice.`],
    [/^KI-Modell „(.+)“ entfernen\? Die Modellkonfiguration und der gespeicherte Schlüssel werden gelöscht\. Installierte Modelle und vorhandene Clips bleiben erhalten\.$/, (_, name) => `Remove AI model “${name}”? The model configuration and saved key will be deleted. Installed models and existing clips will be kept.`],
    [/^(\d{2})\.(\d{2})\.(\d{4})(, .+)?$/, (_, day, month, year, time) => `${day}/${month}/${year}${time || ''}`],
    [/^(.*) · (Administrator|Bediener|Betrachter)$/, (_, name, role) => `${name} · ${translate(role, 'en')}`],
    [/^(\d+) von (\d+) Cloud-Anfragen heute \(UTC\)\.$/, (_, a, b) => `${a} of ${b} cloud requests today (UTC).`],
    [/^(\d+) Modelle gefunden\. Die Modellliste bestätigt keine Bildunterstützung; ein Vision-Modell auswählen\.$/, (_, n) => `${n} models found. A model list does not verify image support; select a vision model.`],
    [/^Livebild · noch bis zu (\d+) Sekunden · (Ton über den Lautstärkeregler|Kamera liefert keinen Ton)(?: · Empfangen: (\d+) × (\d+)(?: · ca\. ([\d.,]+) FPS)?)?$/, (_, n, audio, width, height, fps) => `Live view · up to ${n} seconds left · ${translate(audio, 'en')}${width?' · Received: '+width+' × '+height+(fps?' · approx. '+fps.replace(',','.')+' FPS':''):''}`],
    [/^Serveradresse für dein Handy: (.+)$/, (_, address) => `Server address for your phone: ${address}`],
    [/^HTTPS-Adresse vorbereitet: (.+)\. Externen Zugriff unter Server & Zugriff noch freigeben\.$/, (_, address) => `HTTPS address prepared: ${address}. Enable external access under Server & access.`],
    [/^Verkürzter Clip lokal gespeichert \((\d+) statt (\d+) Sekunden\)\. (.+)$/, (_, actual, requested, audio) => `Shortened clip saved locally (${actual} of ${requested} seconds). ${translate(audio, 'en')}`],
    [/^(\d+) von (\d+) überwacht$/, (_, a, b) => `${a} of ${b} monitored`],
    [/^([●\s]*)(\d+) Sekunden aufnehmen$/, (_, icon, n) => `${icon}Record ${n} seconds`],
    [/^(\d+) Sekunden$/, (_, n) => `${n} seconds`],
    [/^(\d+) Sekunden je Clip · (\d+) Sekunden Mindestabstand zwischen Starts$/, (_, n, gap) => `${n} seconds per clip · ${gap} seconds minimum between starts`],
    [/^(\d+) Ereignisse im ausgewählten Zeitraum$/, (_, n) => `${n} events in the selected period`],
    [/^(\d+) gespeicherte (?:Aufnahme|Aufnahmen)$/, (_, n) => `${n} saved recording${n === '1' ? '' : 's'}`],
    [/^Keine Person \/ kein Gesicht in (\d+) geprüften Bildern erkannt\.$/, (_, n) => `No person / face detected in ${n} checked frames.`],
    [/^Keine Person in (\d+) geprüften Bildern erkannt; deshalb keine Personenmeldung und kein Personenbild\.$/, (_, n) => `No person detected in ${n} checked frames; no person alert or person image was sent.`],
    [/^(\d+) (?:Bilder|Einzelbilder)$/, (_, n) => `${n} frames`],
    [/^(\d+) von (\d+) OpenAI-Anfragen heute \(UTC\)\.$/, (_, a, b) => `${a} of ${b} OpenAI requests today (UTC).`],
    [/^(\d+) lokale Modelle gefunden\.(.*)$/, (_, n, detail) => `${n} local models found.${translate(detail, 'en')}`],
    [/^✓ Gespeichert um (.+)$/, (_, time) => `✓ Saved at ${time}`],
    [/^Zwischen Aufnahmestarts liegen mindestens (\d+) Sekunden\. Bewegungen nach Clipende können in diese Pause fallen\.$/, (_, n) => `Recording starts are at least ${n} seconds apart. Motion after a clip ends may fall within this pause.`],
    [/^Profil (.+)$/, (_, name) => `Profile ${name}`],
    [/^(Clipdauer|Aufnahmeabstand|KI-Anbieter|KI-Modell|Ortsbeschreibung|Funktionen) für (.+)$/, (_, label, name) => `${label === 'KI-Anbieter' ? 'AI provider' : label === 'KI-Modell' ? 'AI model' : translate(label, 'en')} for ${name}`],
    [/^Rolle von (.+)$/, (_, name) => `Role of ${name}`],
    [/^Neues Passwort für (.+)$/, (_, name) => `New password for ${name}`],
    [/^Aufnahme von (.+) abspielen$/, (_, name) => `Play recording from ${name}`],
    [/^Clip von (.+) vom (.+) abspielen$/, (_, name, date) => `Play clip from ${name} on ${translate(date, 'en')}`],
    [/^(?:Zugeordnet|Von dir zugeordnet): (.+)$/, (_, names) => `Assigned: ${names}`],
    [/^Vorbereitete Adresse: (.+)$/, (_, address) => `Prepared address: ${address}`],
    [/^Livebild · noch bis zu (\d+) Sekunden · ohne Ton$/, (_, n) => `Live view · up to ${n} seconds left · no audio`],
    [/^Geprüft: (.+)$/, (_, time) => `Checked: ${time}`],
    [/^Akku (.+)$/, (_, value) => `Battery ${value}`],
    [/^Erste Videodaten nach (.+) s$/, (_, value) => `First video data after ${value} s`],
    [/^Ring-Meldung nach (.+) s$/, (_, value) => `Ring notification after ${value} s`],
    [/^Datei begonnen nach (.+) s$/, (_, value) => `File started after ${value} s`],
    [/^Aufnahmepause: Noch (\d+) Sekunden bis zur nächsten automatischen Aufnahme\. Eingestellter Mindestabstand: (\d+) Sekunden\.$/, (_, left, gap) => `Recording cooldown: ${left} seconds until the next automatic recording. Minimum start interval: ${gap} seconds.`],
    [/^Automatische Aufnahme bei (Bewegung|Klingeln) war für diese Kamera ausgeschaltet\.$/, (_, trigger) => `Automatic recording on ${trigger === 'Bewegung' ? 'motion' : 'doorbell presses'} was disabled for this camera.`],
    [/^(Klingelmeldung|Klingel-Clip|Bewegungsclip|Personenmeldung|KI-Zusammenfassung) war im Kamera-Profil ausgeschaltet\.$/, (_, kind) => `${translate(kind, 'en')} was disabled in the camera profile.`],
    [/^Verkürzter Clip lokal gespeichert \((\d+) statt (\d+) Sekunden\)\. Ohne Ton\.$/, (_, actual, requested) => `Shortened clip saved locally (${actual} of ${requested} seconds). No audio.`],
    [/^(.+) · Push (eingerichtet|aus) · gültig bis (.+)$/, (_, name, push, date) => `${name} · Push ${push === 'aus' ? 'off' : 'configured'} · valid until ${date}`],
    [/^(.+) und zugehörige gespeicherte KI-Zuordnungen entfernen\? Videos bleiben erhalten\.$/, (_, name) => `Remove ${name} and their saved AI assignments? Videos will be kept.`],
    [/^Benutzer (.+) entfernen\?$/, (_, name) => `Remove user ${name}?`],
    [/^(.*)(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), (\d+)\. (\S+) (\d{4})$/, (_, pre, day, date, month, year) => `${pre}${translate(day, 'en')}, ${date} ${translate(month, 'en')} ${year}`],
  ];
  function translate(source, target = language) {
    if (target !== 'en' || typeof source !== 'string' || !source.trim()) return source;
    const trimmed = source.trim();
    let result = dictionary[trimmed];
    if (result === undefined && trimmed === trimmed.toLocaleUpperCase('de-DE')) { const entry = Object.keys(dictionary).find(key => key.toLocaleUpperCase('de-DE') === trimmed); if (entry) result = dictionary[entry].toLocaleUpperCase('en-GB'); }
    if (result === undefined) for (const [pattern, replace] of patterns) if (pattern.test(trimmed)) { result = trimmed.replace(pattern, replace); break; }
    if (result === undefined && /(?<=[.!?])\s+(?=[A-ZÄÖÜ])/.test(trimmed)) result = trimmed.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/).map(part => translate(part, target)).join(' ');
    if (result === undefined && trimmed.includes(' · ')) result = trimmed.split(' · ').map(part => translate(part, target)).join(' · ');
    if (result === undefined && trimmed.startsWith('Discord · ')) result = trimmed;
    if (result === undefined && trimmed.includes(': ')) { const at = trimmed.indexOf(': '); result = translate(trimmed.slice(0, at), target) + ': ' + translate(trimmed.slice(at + 2), target); }
    if (result === undefined) return source;
    return source.slice(0, source.indexOf(trimmed)) + result + source.slice(source.indexOf(trimmed) + trimmed.length);
  }
  window.tuerwacheI18n = { translate, get language() { return language; }, get locale() { return language === 'en' ? 'en-GB' : 'de-DE'; } };
  if (typeof document === 'undefined') return;
  const textSources = new WeakMap(), attributeSources = new WeakMap(), selectors = [];
  const skip = 'script,style,code,pre,[data-i18n-skip],.timeline-summary,.summary-result p,.clip-content>.summary-result,#people-list strong,#user-list strong,.camera-profile-card h3,.clip-content h3,#camera-title';
  function updateText(node) {
    if (!node.parentElement || node.parentElement.closest(skip)) return;
    const previous = textSources.get(node), source = previous && node.nodeValue === previous.output ? previous.source : node.nodeValue;
    const output = translate(source); textSources.set(node, { source, output });
    if (node.nodeValue !== output) node.nodeValue = output;
  }
  function updateAttributes(node) {
    if (node.closest?.('[data-i18n-skip]')) return;
    const stored = attributeSources.get(node) || {};
    for (const name of ['aria-label', 'placeholder', 'title', 'alt', 'label', 'data-label']) if (node.hasAttribute(name)) {
      const value = node.getAttribute(name), previous = stored[name], source = previous && value === previous.output ? previous.source : value;
      const output = translate(source); stored[name] = { source, output }; if (value !== output) node.setAttribute(name, output);
    }
    attributeSources.set(node, stored);
  }
  function update(root) {
    if (root.nodeType === 3) { updateText(root); return; }
    if (root.nodeType !== 1 || root.closest?.('script,style,[data-i18n-skip]')) return;
    updateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) { const node = walker.currentNode; if (node.nodeType === 3) updateText(node); else updateAttributes(node); }
  }
  function setLanguage(value, remember = true) {
    language = value === 'en' ? 'en' : 'de'; document.documentElement.lang = language;
    if (remember) try { localStorage.setItem('tuerwache.language', language); } catch {}
    for (const selector of selectors) selector.value = language;
    update(document.body); update(document.querySelector('title'));
    window.dispatchEvent(new CustomEvent('tw-language', { detail: language }));
  }
  function languageControl(parent, name) {
    const label = document.createElement('label'); label.className = 'language-control';
    const caption = document.createElement('span'); caption.textContent = 'Sprache';
    const select = document.createElement('select'); select.setAttribute('aria-label', name);
    for (const [value, title] of [['de', 'Deutsch'], ['en', 'English']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; option.dataset.i18nSkip = ''; select.append(option); }
    select.value = language; select.onchange = () => setLanguage(select.value); selectors.push(select); label.append(caption, select); parent.prepend(label);
  }
  languageControl(document.querySelector('.account-actions'), 'Sprache auswählen');
  languageControl(document.querySelector('.auth-card'), 'Sprache der Anmeldung auswählen');
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') updateText(record.target);
      else if (record.type === 'attributes') updateAttributes(record.target);
      else for (const node of record.addedNodes) update(node);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder', 'title', 'alt', 'label', 'data-label'] });
  window.addEventListener('storage', event => { if (event.key === 'tuerwache.language') setLanguage(event.newValue, false); });
  setLanguage(language, false);
  const nativeConfirm = window.confirm.bind(window), nativeAlert = window.alert.bind(window);
  window.confirm = message => nativeConfirm(translate(message));
  window.alert = message => nativeAlert(translate(message));
})();
