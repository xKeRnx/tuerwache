(() => {
  const status=document.getElementById('android-app-status'),download=document.getElementById('android-app-download'),file=document.getElementById('android-app-file'),connection=document.getElementById('mobile-connection-state');
  let loadedUser='',loading=false;
  async function load(state){
    if(!state?.user||loading||loadedUser===state.user.id)return;loading=true;
    try{const response=await fetch('/api/mobile/app'),info=await response.json();if(!response.ok)throw new Error(info.error||'App-Status konnte nicht geladen werden.');
      status.textContent=info.android.available?'Testpaket verfügbar':'Noch kein Android-Testpaket';download.hidden=!info.android.available;
      file.textContent=info.android.available?`${info.android.version?'v'+info.android.version+' · ':''}${(info.android.bytes/1048576).toFixed(1)} MiB · ARM64 · ${new Date(info.android.updatedAt).toLocaleDateString(window.tuerwacheI18n?.locale||'de-DE')}`:'Auf diesem Server wurde noch kein Android-Paket hinterlegt.';loadedUser=state.user.id;
    }catch(error){status.textContent='App-Status nicht erreichbar';file.textContent=error.message;download.hidden=true;}finally{loading=false;}
  }
  function render(state){
    if(!state?.user){loadedUser='';download.hidden=true;return;}
    connection.textContent=state.access?.enabled&&state.access.publicOrigin?`Serveradresse für dein Handy: ${state.access.publicOrigin}`:state.access?.publicOrigin?`HTTPS-Adresse vorbereitet: ${state.access.publicOrigin}. Externen Zugriff unter Server & Zugriff noch freigeben.`:'Dein Server ist derzeit nur auf diesem PC erreichbar. Richte zuerst HTTPS und den gewünschten Netzwerkzugriff unter Server & Zugriff ein.';
    if(location.pathname==='/mobile')load(state);
  }
  window.addEventListener('tw-state',({detail:state})=>render(state));
  window.addEventListener('tw-route',({detail:path})=>{if(path==='/mobile')render(window.tw.getState());});
  render(window.tw.getState());
})();
