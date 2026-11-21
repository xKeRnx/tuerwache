import { isIP } from 'node:net';
import { join } from 'node:path';
import { readJson, writeJson } from './storage.mjs';
const normalize=address=>String(address||'').replace(/^::ffff:/,'');
const loopback=address=>['127.0.0.1','::1'].includes(normalize(address));
export class AccessPolicy{
  constructor(root,accounts,{tls,allowedHosts=[],publicOrigin='',trustedProxies=[]}={}){
    this.file=join(root,'access.json');this.accounts=accounts;this.tls=Boolean(tls);this.allowedHosts=allowedHosts;
    this.value={mode:'home',enabled:false,...readJson(this.file,{})};
    this.proxies=trustedProxies.map(normalize);if(this.proxies.some(address=>!isIP(address)))throw new Error('Vertrauenswürdige Proxy-Adressen müssen feste IP-Adressen sein.');
    this.publicOrigin=publicOrigin?new URL(publicOrigin).origin:'';
    if(publicOrigin&&(this.publicOrigin!==publicOrigin.replace(/\/$/,'')||!publicOrigin.startsWith('https://')))throw new Error('PUBLIC_ORIGIN muss eine reine HTTPS-Adresse sein.');
    if(this.proxies.length&&!this.publicOrigin)throw new Error('Proxy-Betrieb erfordert PUBLIC_ORIGIN.');
  }
  readiness(){
    const issues=[];
    if(!this.tls&&!(this.proxies.length&&this.publicOrigin))issues.push('HTTPS-Zertifikat oder vertrauenswürdigen HTTPS-Proxy konfigurieren.');
    if(!this.allowedHosts.length)issues.push('Erlaubte externe Hostnamen konfigurieren.');
    if(this.publicOrigin&&!this.allowedHosts.includes(new URL(this.publicOrigin).host))issues.push('PUBLIC_ORIGIN muss in ALLOWED_HOSTS enthalten sein.');
    if(!this.accounts.users.length||this.accounts.users.some(user=>!user.disabled&&!user.totp))issues.push('Für alle Benutzer zuerst Zwei-Faktor-Anmeldung einrichten.');
    if((this.value.mode==='cloud'||process.env.DEPLOYMENT==='cloud')&&!process.env.AUTH_ENCRYPTION_KEY)issues.push('Für Cloud-Betrieb einen eigenen AUTH_ENCRYPTION_KEY außerhalb des Datenvolumens konfigurieren.');
    return issues;
  }
  state(user){const issues=this.readiness();return {mode:this.value.mode,enabled:this.value.enabled,ready:issues.length===0,issues,mfaEnabled:this.accounts.mfaStatus(user.id),...(user.role==='admin'?{allowedHosts:this.allowedHosts,publicOrigin:this.publicOrigin}: {})};}
  update(input){
    if(input.mode!==undefined&&!['home','cloud'].includes(input.mode))throw new Error('Betriebsort ungültig.');
    if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new Error('Freigabe ungültig.');
    const previous={...this.value};this.value={...this.value,...(input.mode?{mode:input.mode}:{}),...(input.enabled!==undefined?{enabled:input.enabled}:{})};
    const issues=this.readiness();if(this.value.enabled&&issues.length){this.value=previous;throw new Error(issues.join(' '));}
    writeJson(this.file,this.value);
  }
  context(request){
    const peer=normalize(request.socket.remoteAddress),proxy=this.proxies.includes(peer),forwarded=request.headers['x-forwarded-proto'];
    if(proxy&&forwarded!==undefined){
      if(forwarded!=='https'||request.headers.host!==new URL(this.publicOrigin).host||!isIP(request.headers['x-forwarded-for']||''))throw new Error('Ungültige Proxy-Anfrage.');
      return {secure:true,remote:true,address:normalize(request.headers['x-forwarded-for']),origin:this.publicOrigin};
    }
    if(forwarded!==undefined||request.headers['x-forwarded-for']!==undefined)throw new Error('Nicht vertrauenswürdige Proxy-Header.');
    return {secure:Boolean(request.socket.encrypted),remote:!loopback(peer),address:peer,origin:`${request.socket.encrypted?'https':'http'}://${request.headers.host}`};
  }
  permits(context){return !context.remote||(context.secure&&this.value.enabled&&this.readiness().length===0);}
}
