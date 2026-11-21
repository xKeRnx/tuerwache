import { createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function decode(secret){let bits=0,value=0,out=[];for(const char of secret){const digit=alphabet.indexOf(char);if(digit<0)throw new Error('Ungültiger 2FA-Schlüssel.');value=(value<<5)|digit;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret,step=Math.floor(Date.now()/30000),digits=6){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const hash=createHmac('sha1',decode(secret)).update(counter).digest(),offset=hash.at(-1)&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function verifyTotp(secret,code,lastStep=-1,now=Date.now()){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const current=Math.floor(now/30000);let found=null;
  for(const step of [current-1,current,current+1])if(step>lastStep&&timingSafeEqual(Buffer.from(totp(secret,step)),Buffer.from(code)))found=step;
  return found;
}
export class TotpVault{
  constructor(root,allowCreate=true){
    const file=join(root,'auth-encryption.key');
    if(process.env.AUTH_ENCRYPTION_KEY){if(!/^[a-f0-9]{64}$/i.test(process.env.AUTH_ENCRYPTION_KEY))throw new Error('AUTH_ENCRYPTION_KEY benötigt 64 Hex-Zeichen.');this.key=Buffer.from(process.env.AUTH_ENCRYPTION_KEY,'hex');}
    else{try{this.key=readFileSync(file);}catch(error){if(error.code!=='ENOENT')throw error;if(!allowCreate)throw new Error('2FA-Verschlüsselungsschlüssel fehlt. Sicherung wiederherstellen oder mit Wiederherstellungscode lokal anmelden.');this.key=randomBytes(32);writeFileSync(file,this.key,{mode:0o600,flag:'wx'});}}
    if(this.key.length!==32)throw new Error('2FA-Verschlüsselungsschlüssel ungültig.');
  }
  seal(secret){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce),body=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString('base64');}
  open(value){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
}
