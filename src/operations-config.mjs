import {join} from 'node:path';
import {readJson,writeJson} from './storage.mjs';
import {TotpVault} from './totp.mjs';
export class OperationsConfig{
  constructor(root){this.root=root;this.file=join(root,'operations.json');const saved=readJson(this.file,{});
    this.value={recording:{maxCameras:4,...saved.recording},retention:{local:{enabled:false,days:30,maxGiB:100,...saved.retention?.local},cloud:{enabled:false,days:90,maxGiB:0,...saved.retention?.cloud}},backups:{enabled:false,intervalHours:24,keepCount:7,includeClips:true,...saved.backups},monitor:{enabled:true,discordAlerts:false,diskWarnGiB:2,silenceHours:0,...saved.monitor},retries:{enabled:true,maxAttempts:3,...saved.retries}};}
  get vault(){return this._vault??=new TotpVault(this.root,!readJson(join(this.root,'users.json'),[]).some(user=>user.totp||user.pendingTotp));}
  public(){const value=structuredClone(this.value);value.backups.passphraseSet=Boolean(value.backups.sealedPassphrase);delete value.backups.sealedPassphrase;return value;}
  passphrase(){return this.value.backups.sealedPassphrase?this.vault.open(this.value.backups.sealedPassphrase):null;}
  update(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Betriebseinstellungen ungültig.');
    const next=structuredClone(this.value);
    const fields={recording:{maxCameras:[1,8]},backups:{enabled:'bool',intervalHours:[1,720],keepCount:[1,100],includeClips:'bool',passphrase:'secret',clearPassphrase:'bool'},monitor:{enabled:'bool',discordAlerts:'bool',diskWarnGiB:[.5,1024],silenceHours:[0,720]},retries:{enabled:'bool',maxAttempts:[1,5]}};
    const assign=(target,source,schema)=>{if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Betriebseinstellungen ungültig.');for(const [key,value]of Object.entries(source)){const rule=schema[key];if(!rule)throw Error('Unbekannte Betriebseinstellung.');if(rule==='bool'){if(typeof value!=='boolean')throw Error('Schalter ungültig.');target[key]=value;}else if(rule==='secret'){if(typeof value!=='string'||value.length<16||value.length>256)throw Error('Backup-Passphrase muss 16 bis 256 Zeichen enthalten.');target.sealedPassphrase=this.vault.seal(value);}else{if(typeof value!=='number'||!Number.isFinite(value)||value<rule[0]||value>rule[1]||(key!=='maxGiB'&&key!=='diskWarnGiB'&&!Number.isInteger(value)))throw Error('Wert außerhalb des erlaubten Bereichs.');target[key]=value;}}};
    for(const [key,value]of Object.entries(input)){
      if(key==='retention'){if(!value||Object.keys(value).some(k=>!['local','cloud'].includes(k)))throw Error('Aufbewahrung ungültig.');for(const [location,policy]of Object.entries(value))assign(next.retention[location],policy,location==='local'?{enabled:'bool',days:[1,3650],maxGiB:[.1,100000]}:{enabled:'bool',days:[1,3650],maxGiB:[0,100000]});}
      else if(fields[key])assign(next[key],value,fields[key]);else throw Error('Unbekannte Betriebseinstellung.');
    }
    if(input.backups?.clearPassphrase){delete next.backups.sealedPassphrase;next.backups.enabled=false;}
    delete next.backups.clearPassphrase;
    if(next.backups.enabled&&!next.backups.sealedPassphrase)throw Error('Für automatische Sicherungen zuerst eine Backup-Passphrase hinterlegen.');
    this.value=next;writeJson(this.file,next);return this.public();
  }
}
