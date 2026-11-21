import {randomBytes,createCipheriv,createDecipheriv,createHash,scrypt} from 'node:crypto';
import {promisify} from 'node:util';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,appendFile,mkdir,rename,unlink,rm,writeFile,readFile,lstat,readdir} from 'node:fs/promises';
import {StringDecoder} from 'node:string_decoder';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {resolve,join,dirname,sep} from 'node:path';
const derive=promisify(scrypt),magic=Buffer.from('TWBACKUP1\n');
const backupFiles=new Set(['settings.json','events.json','users.json','session.json','camera-access.json','ring-accounts.json','network-cameras.json','known-faces.json','summary-usage.json','operations.json','ai-quality.json','face-suggestions.json','auth-encryption.key'].map(name=>'data/'+name));
const safeName=name=>typeof name==='string'&&(backupFiles.has(name)||/^data\/(?:clips\/[a-f0-9-]{36}\.mp4|archive-thumbnails\/[a-f0-9-]{36}\.jpg)$/.test(name));
export const backupHash=bytes=>createHash('sha256').update(bytes).digest('hex');
function password(value){if(typeof value!=='string'||value.length<16||value.length>256)throw Error('Backup-Passphrase muss 16 bis 256 Zeichen enthalten.');}

// Archive framing is NDJSON; cryptography is standard scrypt + AES-256-GCM.
// Files are streamed in bounded chunks and individually hashed. No executable
// archives, symlinks, absolute paths, or unverified writes into the live data.
export async function createBackupArchive(target,passphrase,records,metadata={}){
  password(passphrase);const salt=randomBytes(16),nonce=randomBytes(12);
  const key=await derive(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  const header=Buffer.concat([magic,Buffer.from(JSON.stringify({salt:salt.toString('hex'),nonce:nonce.toString('hex')})+'\n')]);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(header);
  const temporary=target+'.part';let files=0,bytes=0;
  async function* lines(){
    yield JSON.stringify({...metadata,type:'meta',version:1})+'\n';
    for(const record of records){
      if(!safeName(record.name))throw Error('Ungültiger Sicherungspfad.');
      let size,source;
      if(record.bytes){size=record.bytes.length;source=Readable.from([record.bytes]);}
      else{const info=await lstat(record.path);if(!info.isFile()||info.isSymbolicLink())throw Error('Nur reguläre Dateien können gesichert werden.');size=info.size;source=createReadStream(record.path,{highWaterMark:65536});}
      yield JSON.stringify({type:'file',name:record.name,size})+'\n';const hash=createHash('sha256');let length=0;
      for await(const chunk of source){
        for(let offset=0;offset<chunk.length;offset+=65536){const part=chunk.subarray(offset,offset+65536);hash.update(part);length+=part.length;yield JSON.stringify({type:'chunk',data:part.toString('base64')})+'\n';}
      }
      if(length!==size)throw Error('Datei wurde während der Sicherung geändert.');
      yield JSON.stringify({type:'end',sha256:hash.digest('hex')})+'\n';files++;bytes+=length;
    }
    yield JSON.stringify({type:'complete',files,bytes})+'\n';
  }
  try{
    const output=createWriteStream(temporary,{flags:'wx',mode:0o600});output.write(header);
    await pipeline(Readable.from(lines()),createGzip(),cipher,output);
    await appendFile(temporary,cipher.getAuthTag());await rename(temporary,target);
    return {files,bytes};
  }catch(error){await unlink(temporary).catch(()=>{});throw error;}finally{key.fill(0);}
}

export async function verifyBackupArchive(source,passphrase,staging,{maxBytes=2*1024**4,maxFiles=100000}={}){
  password(passphrase);const handle=await open(source,'r');let key;
  const root=resolve(staging);const manifest=[];let current=null,total=0,metadata=null,complete=false;
  try{
    const info=await handle.stat();if(info.size<80)throw Error('Sicherung unvollständig.');
    const prefix=Buffer.alloc(512);const {bytesRead}=await handle.read(prefix,0,prefix.length,0);
    if(!prefix.subarray(0,magic.length).equals(magic))throw Error('Unbekanntes Sicherungsformat.');
    const end=prefix.indexOf(10,magic.length);if(end<0||end>=bytesRead)throw Error('Sicherungskopf ungültig.');
    const settings=JSON.parse(prefix.subarray(magic.length,end).toString());
    if(!/^[a-f0-9]{32}$/.test(settings.salt)||!/^[a-f0-9]{24}$/.test(settings.nonce))throw Error('Sicherungskopf ungültig.');
    key=await derive(passphrase,Buffer.from(settings.salt,'hex'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const tag=Buffer.alloc(16);await handle.read(tag,0,16,info.size-16);
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(settings.nonce,'hex'));decipher.setAAD(prefix.subarray(0,end+1));decipher.setAuthTag(tag);
    await mkdir(root,{recursive:false,mode:0o700});
    async function accept(line){
      const record=JSON.parse(line);
      if(complete)throw Error('Unerwartete Daten nach Sicherungsende.');
      if(record.type==='meta'){if(metadata||current||manifest.length||record.version!==1)throw Error('Sicherungsmetadaten ungültig.');metadata=record;}
      else if(record.type==='file'){
        if(!metadata||current||!safeName(record.name)||manifest.some(file=>file.name===record.name)||!Number.isSafeInteger(record.size)||record.size<0||record.size>maxBytes-total||manifest.length>=maxFiles)throw Error('Dateieintrag ungültig oder Sicherung zu groß.');
        const target=resolve(root,record.name);if(!target.startsWith(root+sep))throw Error('Ungültiger Wiederherstellungspfad.');
        await mkdir(dirname(target),{recursive:true,mode:0o700});
        current={...record,handle:await open(target,'wx',0o600),hash:createHash('sha256'),written:0};
      }else if(record.type==='chunk'){
        if(!current||typeof record.data!=='string'||record.data.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(record.data))throw Error('Dateiblock ungültig.');
        const data=Buffer.from(record.data,'base64');if(data.length>65536||current.written+data.length>current.size)throw Error('Dateigröße überschritten.');
        await current.handle.writeFile(data);current.hash.update(data);current.written+=data.length;
      }else if(record.type==='end'){
        if(!current||current.written!==current.size||current.hash.digest('hex')!==record.sha256)throw Error('Dateiprüfsumme stimmt nicht.');
        await current.handle.close();manifest.push({name:current.name,size:current.size,sha256:record.sha256});total+=current.size;current=null;
      }else if(record.type==='complete'){
        if(!metadata||current||record.files!==manifest.length||record.bytes!==total)throw Error('Sicherung unvollständig.');complete=true;
      }else throw Error('Unbekannter Sicherungseintrag.');
    }
    let pending='';const decoder=new StringDecoder('utf8');
    const input=createReadStream(source,{start:end+1,end:info.size-17});
    const uncompressed=input.pipe(decipher).pipe(createGunzip());
    // Pipe errors must destroy the consumer too, including a wrong GCM tag.
    input.on('error',error=>uncompressed.destroy(error));decipher.on('error',error=>uncompressed.destroy(error));
    try{for await(const chunk of uncompressed){pending+=decoder.write(chunk);let at;while((at=pending.indexOf('\n'))!==-1){const line=pending.slice(0,at);pending=pending.slice(at+1);if(line.length>100000)throw Error('Sicherungseintrag zu groß.');await accept(line);}if(pending.length>100000)throw Error('Sicherungseintrag zu groß.');}pending+=decoder.end();}finally{input.destroy();decipher.destroy();uncompressed.destroy();}
    if(!complete||pending.trim()||current)throw Error('Sicherung unvollständig.');
    const proof={version:1,verifiedAt:new Date().toISOString(),files:manifest,bytes:total,metadata};
    await writeFile(join(root,'verification.json'),JSON.stringify(proof,null,2),{mode:0o600,flag:'wx'});return proof;
  }catch(error){if(current?.handle)await current.handle.close().catch(()=>{});throw new Error(error.message?.startsWith('Sicherung')||error.message?.startsWith('Datei')?error.message:'Sicherung konnte nicht geprüft werden. Passphrase und Datei prüfen.');}
  finally{await handle.close();key?.fill(0);}
}

export async function discardStaging(root,id){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Ungültige Prüfungskennung.');
  const parent=resolve(root),target=resolve(parent,id);
  if(dirname(target)!==parent)throw Error('Unsicheres Aufräumziel.');
  await rm(target,{recursive:true,force:true});
}

export async function verifyStaging(root){
  const rootInfo=await lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('Ungültiger Prüfungsordner.');
  const proof=JSON.parse(await readFile(join(root,'verification.json'),'utf8'));
  if(proof.version!==1||!Array.isArray(proof.files))throw Error('Gültiger Prüfbericht fehlt.');
  const expected=new Set(['verification.json',...proof.files.map(file=>file.name)]);
  async function walk(directory,prefix=''){
    for(const item of await readdir(directory,{withFileTypes:true})){
      const name=prefix+item.name,path=join(directory,item.name),info=await lstat(path);
      if(info.isSymbolicLink())throw Error('Unzulässiger Link im Prüfungsordner.');
      if(info.isDirectory()){if(![...expected].some(file=>file.startsWith(name+'/')))throw Error('Zusätzlicher Prüfungsordner.');await walk(path,name+'/');}
      else if(!info.isFile()||!expected.has(name))throw Error('Zusätzliche Datei im Prüfungsordner.');
    }
  }
  await walk(root);
  for(const file of proof.files){if(!safeName(file.name))throw Error('Prüfbericht ungültig.');const path=join(root,file.name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size!==file.size)throw Error('Geprüfte Datei wurde verändert.');const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);if(hash.digest('hex')!==file.sha256)throw Error('Geprüfte Datei wurde verändert.');}
  return proof;
}
