import { isQuiet } from './quiet-hours.mjs';

export class MobilePush {
  constructor(service, sessions, send = async body => {
    const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Push-Dienst nicht erreichbar.');
    return (await response.json()).data;
  }) { this.service = service; this.sessions = sessions; this.send = send; this.tail = Promise.resolve(); this.pending = 0; this.seen = new Set(); this.cooldown = new Map(); this.closed = false; }
  notify(entry, kind) {
    if (this.closed || this.pending >= 50 || this.seen.has(`${entry.id}:${kind}`) || !this.service.features.settings.profile(entry.cameraId).monitoring) return;
    this.seen.add(`${entry.id}:${kind}`); if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    const key = `${entry.cameraId}:${kind}`, now = Date.now();
    if (now - (this.cooldown.get(key) || 0) < (kind === 'ding' ? 10000 : 60000)) return;
    this.cooldown.set(key, now); this.pending++;
    const task = this.tail.then(async () => {
      for (const session of this.sessions.sessions) {
        const user = this.sessions.valid(session);
        if (this.closed || !user || !session.pushToken || !session.subscriptions[entry.cameraId]?.includes(kind) || !this.service.features.settings.profile(entry.cameraId).monitoring || !this.sessions.accounts.permits(user, 'push', entry.cameraId) || isQuiet(this.sessions.accounts.quietHours(user), kind)) continue;
        try {
          // Lock-screen text deliberately contains no pictures, names, scene descriptions or private URLs.
          const result = await this.send({ to: session.pushToken, title: 'Türwache', body: (session.language==='en'?{ding:'The doorbell rang.',clip:'A new doorbell clip is ready.',person:'Person or face detected.',summary:'A new scene description is ready.'}:{ding:'Es hat geklingelt.',clip:'Ein neuer Klingel-Clip ist bereit.',person:'Person oder Gesicht erkannt.',summary:'Eine neue Szenenbeschreibung ist bereit.'})[kind], sound: 'default', channelId: 'tuerwache', data: { eventId: entry.id, cameraId: entry.cameraId, kind } });
          this.receipt(session,result);
        } catch { session.lastPush = { status: 'error', message: 'Push-Dienst nicht rechtzeitig erreichbar. Kein automatischer erneuter Versand.' }; }
        this.sessions.save();
      }
    }).finally(() => this.pending--);
    this.tail = task.catch(() => {});
  }
  async test(user){
    if(!user?.mobileId)throw Error('Test direkt in der angemeldeten Handy-App starten.');
    const session=this.sessions.owned(user.mobileId,user);
    if(!session.pushToken)throw Error('Push auf diesem Handy zuerst einrichten.');
    if(Date.now()-(session.lastPushTest||0)<60000)throw Error('Zwischen Push-Tests eine Minute warten.');
    session.lastPushTest=Date.now();this.sessions.save();
    try{const result=await this.send({to:session.pushToken,title:'Türwache',body:session.language==='en'?'Test notification. Open the app to check your connection.':'Testnachricht. Öffne die App, um deine Verbindung zu prüfen.',sound:'default',channelId:'tuerwache',data:{kind:'test'}});this.receipt(session,result);this.sessions.save();if(result?.status!=='ok')throw Error();}
    catch{throw Error('Push-Test nicht bestätigt. Gerätekonfiguration prüfen; kein automatischer erneuter Versand.');}
  }
  receipt(session,result){
    if(result?.status==='ok'&&typeof result.id==='string'){
      session.pushReceipts=[...(session.pushReceipts||[]).slice(-19),{id:result.id,at:Date.now()}];
      session.lastPush={status:'accepted',at:new Date().toISOString(),message:'Vom Push-Dienst angenommen; Zustellung am Handy noch nicht bestätigt.'};
    }else{session.lastPush={status:'error',at:new Date().toISOString(),message:'Push-Dienst hat die Nachricht abgelehnt.'};if(result?.details?.error==='DeviceNotRegistered')delete session.pushToken;}
  }
  async checkReceipts(fetchReceipts=async ids=>{
    const response=await fetch('https://exp.host/--/api/v2/push/getReceipts',{method:'POST',headers:{'content-type':'application/json',...(process.env.EXPO_ACCESS_TOKEN?{authorization:`Bearer ${process.env.EXPO_ACCESS_TOKEN}`}:{})},body:JSON.stringify({ids}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error();return (await response.json()).data;
  }){
    if(this.checkingReceipts||this.closed)return;this.checkingReceipts=true;
    try{
      const now=Date.now(),pending=this.sessions.sessions.filter(session=>this.sessions.valid(session)).flatMap(session=>(session.pushReceipts||[]).filter(ticket=>now-ticket.at>=900000).map(ticket=>({session,ticket}))).slice(0,100);
      if(!pending.length)return;const receipts=await fetchReceipts(pending.map(({ticket})=>ticket.id));
      for(const {session,ticket}of pending){const result=receipts?.[ticket.id];if(!result&&now-ticket.at<86400000)continue;
        session.pushReceipts=session.pushReceipts.filter(item=>item.id!==ticket.id);
        // Provider acceptance is not proof that the person saw the notification.
        if(!session.lastPush?.at||ticket.at>=Date.parse(session.lastPush.at)-1000)session.lastPush={status:result?.status==='ok'?'provider-delivered':result?'error':'unconfirmed',at:new Date(ticket.at).toISOString(),message:result?.status==='ok'?'An Apple/Google übergeben; Anzeige am Handy nicht bestätigt.':result?'Apple/Google haben die Nachricht abgelehnt.':'Keine Zustellbestätigung erhalten; kein automatischer erneuter Versand.'};
        if(result?.details?.error==='DeviceNotRegistered')delete session.pushToken;
      }
      this.sessions.save();
    }catch{/* A failed receipt lookup never resends the notification. */}finally{this.checkingReceipts=false;}
  }
  async drain() { this.closed = true; await this.tail; }
}
