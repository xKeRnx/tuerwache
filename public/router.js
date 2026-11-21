const pages = [
  ['/', 'Übersicht', 'Ein Blick vor die Tür.', 'Livebild, Aufnahme und Kamerastatus.', false],
  ['/sites', 'Standorte', 'Kameras nach Standort', 'Kamerastatus und letztes Ereignis im Überblick.', false],
  ['/events', 'Ereignisse', 'Was vor deiner Tür passiert.', 'Aufnahmen, Erkennungen und Benachrichtigungen.', false],
  ['/clips', 'Clips', 'Deine Aufnahmen', 'Gespeicherte Clips ansehen und herunterladen.', false],
  ['/timeline', 'Zeitstrahl', 'Dein Zeitstrahl', 'Aufnahmen und Ereignisse nach Zeit und Kamera.', false],
  ['/visits', 'Besuche', 'Ein Besuch, alle Ereignisse.', 'Bewegung, Klingeln und zugehörige Clips zusammen ansehen.', false],
  ['/operations', 'Betrieb', 'Alles im Blick.', 'Verbindung, Verarbeitung und Speicherzustand.', true],
  ['/operations/storage', 'Aufbewahrung', 'Platz für neue Aufnahmen.', 'Getrennte Regeln für lokale und Cloud-Kopien.', true],
  ['/operations/backups', 'Sicherungen', 'Deine Daten mitnehmen.', 'Verschlüsselte Sicherungen und geprüfte Wiederherstellung.', true],
  ['/ai-review', 'KI-Qualität', 'Beschreibungen verbessern.', 'Ergebnisse bewerten und Modelle auf denselben Clips vergleichen.', true],
  ['/cameras', 'Kameras', 'Jede Kamera nach deinen Regeln.', 'Überwachung und Funktionen für jede Kamera einstellen.', true],
  ['/ai', 'KI-Anbieter', 'Deine KI, deine Wahl.', 'Lokale Modelle und optionale Cloud-Auswertung einrichten.', true],
  ['/discord', 'Discord', 'Meldungen in deinem Kanal.', 'Discord verbinden und den Versand prüfen.', true],
  ['/storage', 'Speicher', 'Ein Platz für deine Aufnahmen.', 'Lokalen Speicher und optionale R2/S3-Kopien verwalten.', true],
  ['/faces', 'Gesichter', 'Vertraute Gesichter.', 'Bekannte Personen lokal einlernen und verwalten.', true],
  ['/users', 'Benutzer', 'Wer darf was sehen?', 'Benutzerkonten und Rollen verwalten.', true],
  ['/connection', 'Kameraverbindungen', 'Kameraverbindungen', 'Verbinde Ring-Konten und Kameras aus deinem Heimnetz.', true],
  ['/mobile', 'Handy-App', 'Dein Zuhause unterwegs.', 'Handys, Push-Benachrichtigungen und Serverzugriff.', false],
  ['/access', 'Server & Zugriff', 'Server & Fernzugriff', 'Betriebsort, Zwei-Faktor-Anmeldung und Freigabe.', false],
];
const legacy = { overview: '/', history: '/events', 'camera-profiles': '/cameras', 'summary-settings': '/ai', discord: '/discord', settings: '/storage', people: '/faces', users: '/users', connection: '/connection' };
const navigationGroups = [
  ['Überwachung', ['/', '/sites', '/events', '/clips', '/timeline', '/visits']],
  ['KI & Automationen', ['/ai', '/ai-review', '/faces', '/discord']],
  ['Verwaltung', ['/cameras', '/connection', '/users', '/mobile']],
  ['System', ['/operations', '/storage', '/access', '/docs']],
];
const pagesByPath = new Map(pages.map(page => [page[0], page]));
const main = document.querySelector('main');
const body = document.createElement('div'); body.id = 'page-outlet';
main.insertBefore(body, document.querySelector('footer'));
const containers = new Map();
for (const [path, label, , , admin] of pages) {
  const section = document.createElement('div'); section.className = 'app-page'; section.dataset.page = path; section.hidden = true;
  if (admin) section.dataset.adminPage = '';
  section.setAttribute('aria-label', label); body.append(section); containers.set(path, section);
}
containers.get('/').append(document.querySelector('.workspace'));
for (const [path, selector] of [['/events', '#history'], ['/cameras', '#camera-profiles'], ['/ai', '#summary-settings'], ['/discord', '#discord'], ['/storage', '#settings'], ['/faces', '#people'], ['/users', '#users'], ['/connection', '#camera-connections'], ['/mobile', '.mobile-info']]) containers.get(path).append(document.querySelector(selector));
document.querySelector('.management-grid')?.remove();
const rail = document.querySelector('.rail');
const navigation = rail.querySelector('nav');
for (const [index, [title, paths]] of navigationGroups.entries()) {
  const group = document.createElement('section'); group.className = 'nav-group';
  const heading = document.createElement('h2');
  heading.id = `nav-group-${index}`;
  heading.textContent = title;
  group.setAttribute('aria-labelledby', heading.id);
  group.append(heading);
  for (const path of paths) {
    const [, label, , , admin] = pagesByPath.get(path) || [path, 'Dokumentation'];
    const link = document.createElement('a'); link.href = path;
    const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true');
    link.append(icon, document.createTextNode(label));
    if (admin) link.dataset.admin = '';
    group.append(link);
  }
  navigation.append(group);
}
const menu = document.createElement('button'); menu.type = 'button'; menu.className = 'nav-toggle'; menu.textContent = 'Menü';
menu.setAttribute('aria-controls', navigation.id);
rail.querySelector('.brand').after(menu);
function setMenu(open) {
  menu.setAttribute('aria-expanded', String(open));
  rail.classList.toggle('menu-open', open);
}
setMenu(false);
menu.onclick = () => setMenu(menu.getAttribute('aria-expanded') !== 'true');
rail.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true') return;
  setMenu(false);
  menu.focus();
});
let current = '';
function renderPage(focus = false) {
  const user = window.tw.getState()?.user;
  let page = pagesByPath.get(location.pathname) || pages[0];
  if (user && page[4] && user.role !== 'admin') { page = pages[0]; history.replaceState({}, '', '/'); }
  for (const [path, section] of containers) section.hidden = path !== page[0];
  for (const link of navigation.querySelectorAll('a')) {
    const path = link.getAttribute('href');
    const active = path === page[0];
    const parent = path === '/operations' && page[0].startsWith('/operations/');
    link.classList.toggle('nav-active', active || parent);
    if (active || parent) link.setAttribute('aria-current', active ? 'page' : 'location'); else link.removeAttribute('aria-current');
    if (link.hasAttribute('data-admin')) link.hidden = user?.role !== 'admin';
  }
  const heading = document.querySelector('.heading h1'); heading.textContent = page[2]; heading.tabIndex = -1;
  document.querySelector('.heading .eyebrow').textContent = page[1].toLocaleUpperCase('de-DE');
  document.querySelector('.heading h1 + p').textContent = page[3];
  document.querySelector('.phase-label').textContent = 'TÜRWACHE';
  document.title = `${page[1]} · Türwache`;
  if (current !== page[0] || focus) { window.scrollTo({ top: 0 }); if (focus && user) heading.focus({ preventScroll: true }); }
  if (current !== page[0]) window.dispatchEvent(new CustomEvent('tw-route', { detail: page[0] }));
  current = page[0];
}
function navigate(path, replace = false) {
  if (!containers.has(path)) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  setMenu(false);
  renderPage(true);
}
document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  const url = new URL(link.href, location.href);
  if (url.origin === location.origin && containers.has(url.pathname) && !url.hash) { event.preventDefault(); navigate(url.pathname); }
});
window.addEventListener('popstate', () => { setMenu(false); renderPage(true); });
window.addEventListener('hashchange', () => { const route = legacy[location.hash.slice(1)]; if (route) navigate(route, true); });
window.addEventListener('tw-state', () => renderPage());
window.tw.navigate = navigate;
if (legacy[location.hash.slice(1)]) history.replaceState({}, '', legacy[location.hash.slice(1)]);
renderPage();
