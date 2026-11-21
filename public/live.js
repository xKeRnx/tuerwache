let streaming = false, hls = null, source = '', expiring = false, stopping = false;
const video = document.getElementById('player');
const controls = document.querySelector('.camera-controls');
const toggle = document.createElement('button'); toggle.className = 'button'; toggle.type = 'button'; toggle.textContent = 'Livebild starten'; controls.append(toggle);
const status = document.createElement('p'); status.className = 'small-note'; status.setAttribute('role', 'status'); controls.after(status);
function dispose() {
  if (!streaming) return;
  streaming = false; source = ''; hls?.destroy(); hls = null;
  video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  document.getElementById('video-placeholder').hidden = false;
}
async function stop() {
  if (stopping || (!streaming && !window.tw.getState()?.live)) return;
  stopping = true; dispose();
  try { await window.tw.action('/api/live/stop'); } finally { stopping = false; }
}
window.tw.stopLive = stop;
toggle.onclick = () => streaming ? stop() : window.tw.action('/api/live/start', { cameraId: document.getElementById('camera-select').value });
window.addEventListener('tw-state', ({ detail: state }) => {
  const camera = state.cameras?.find(camera => camera.id === document.getElementById('camera-select').value);
  const live = state.live;
  if (stopping) { dispose(); return; }
  toggle.textContent = live ? 'Livebild beenden' : 'Livebild starten';
  toggle.disabled = !state.user || (!live && (!camera?.features?.monitoring || !window.tw.can(camera.id, 'live') || camera.offline || state.phase !== 'connected'));
  if (!state.user || !live) { dispose(); status.textContent = 'Livebild mit Kameraton · maximal 90 Sekunden zum Schutz des Akkus.'; return; }
  const seconds = Math.max(0, Math.ceil((Date.parse(live.expiresAt) - Date.now()) / 1000));
  status.textContent = `Livebild · noch bis zu ${seconds} Sekunden · ${live.hasAudio === false ? 'Kamera liefert keinen Ton' : 'Ton über den Lautstärkeregler'}`;
  if(live.video?.width&&live.video?.height){
    const fps=Number(live.video.framesPerSecond);
    status.textContent+=` · Empfangen: ${live.video.width} × ${live.video.height}${Number.isFinite(fps)&&fps>0?' · ca. '+fps.toLocaleString('de-DE',{maximumFractionDigits:1})+' FPS':''}`;
  }
  if (live.status !== 'ready' || live.url === source) return;
  dispose(); source = live.url; streaming = true; expiring = false;
  video.hidden = false; document.getElementById('video-placeholder').hidden = true;
  if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = live.url;
  else if (window.Hls?.isSupported()) {
    hls = new Hls({ enableWorker: false }); hls.loadSource(live.url); hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { status.textContent = 'Livebild unterbrochen. Bitte neu starten.'; stop(); } });
  } else { status.textContent = 'Dieser Browser unterstützt das Liveformat nicht.'; stop(); return; }
  video.play().catch(() => { status.textContent += ' · Zum Abspielen auf das Video tippen.'; });
});
window.addEventListener('tw-route', ({ detail }) => { if (detail !== '/') { video.pause(); if (streaming) stop(); } });
document.getElementById('camera-select').addEventListener('change',()=>{if(streaming)stop();});
setInterval(() => { const live = window.tw.getState()?.live; if (streaming && live && Date.parse(live.expiresAt) <= Date.now() && !expiring) { expiring = true; stop(); } }, 1000);
window.addEventListener('pagehide', () => { if (streaming) { dispose(); fetch('/api/live/stop', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-local-token': window.tw.getState()?.csrf || '' }, body: '{}' }).catch(() => {}); } });
const devices = document.getElementById('mobile-devices');
window.addEventListener('tw-state', ({ detail: state }) => {
  devices.replaceChildren();
  for (const device of state.mobile?.devices || []) {
    const row = window.tw.element('div', 'management-row');
    row.append(window.tw.element('span', '', `${device.name} · Push ${device.pushEnabled ? 'eingerichtet' : 'aus'} · gültig bis ${new Date(device.expiresAt).toLocaleDateString('de-DE')}`));
    const revoke = window.tw.element('button', 'text-button danger', 'Handy abmelden'); revoke.type = 'button'; revoke.onclick = () => window.tw.action('/api/mobile/revoke', { id: device.id }); row.append(revoke);
    devices.append(row);
  }
  if (!state.mobile?.devices?.length) devices.append(window.tw.element('p', 'small-note', 'Noch kein Handy mit der nativen App angemeldet.'));
});
