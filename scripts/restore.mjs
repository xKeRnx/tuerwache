import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,rename,writeFile,cp,copyFile,unlink,rmdir,statfs} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
import {createConnection} from 'node:net';
import {verifyStaging} from '../src/backup-archive.mjs';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function restoreVerified({projectRoot,staging,dataRoot=join(projectRoot,'data'),apply=false,serverRunning}={}){
  projectRoot=resolve(projectRoot);dataRoot=resolve(dataRoot);
  const proof=await verifyStaging(staging);
  if(!apply)return {valid:true,files:proof.files.length,bytes:proof.bytes,apply:false};
  if(await serverRunning())throw Error('Server vor der Wiederherstellung stoppen.');
  const importedKey=await readFile(join(staging,'data/auth-encryption.key'));
  if(process.env.AUTH_ENCRYPTION_KEY&&!Buffer.from(process.env.AUTH_ENCRYPTION_KEY,'hex').equals(importedKey))throw Error('AUTH_ENCRYPTION_KEY passt nicht zur Sicherung. Zuerst die passende Schlüsselkonfiguration herstellen.');
  if(dataRoot===projectRoot||dataRoot===dirname(dataRoot))throw Error('Ungültiger Wiederherstellungspfad.');
  const activationRoot=resolve(dirname(dataRoot),'.tuerwache-restore-'+randomUUID());
  if(dirname(activationRoot)!==dirname(dataRoot))throw Error('Unsicheres Wiederherstellungsziel.');
  const disk=await statfs(dirname(dataRoot));if(disk.bavail*disk.bsize<proof.bytes+512*1024**2)throw Error('Nicht genügend Platz für eine geprüfte Wiederherstellungskopie.');
  await mkdir(activationRoot,{mode:0o700});
  await cp(join(staging,'data'),join(activationRoot,'data'),{recursive:true,errorOnExist:true,force:false});
  await copyFile(join(staging,'verification.json'),join(activationRoot,'verification.json'));
  await verifyStaging(activationRoot);
  const stagedData=join(activationRoot,'data');
  for(const name of ['events.json','settings.json']){
    const file=join(stagedData,name),value=JSON.parse(await readFile(file,'utf8'));
    if(name==='settings.json')value.clipsDirectory=join(dataRoot,'clips');
    else for(const event of value)if(event.clip)event.directory=join(dataRoot,'clips');
    await writeFile(file,JSON.stringify(value,null,2),{mode:0o600});
  }
  const operationFile=join(stagedData,'operations.json');
  try{const operations=JSON.parse(await readFile(operationFile,'utf8'));operations.backups={...operations.backups,enabled:false};operations.retention={local:{...operations.retention?.local,enabled:false},cloud:{...operations.retention?.cloud,enabled:false}};operations.monitor={...operations.monitor,discordAlerts:false};await writeFile(operationFile,JSON.stringify(operations,null,2),{mode:0o600});}catch(error){if(error.code!=='ENOENT')throw error;}
  // All final targets are explicit absolute paths. Existing data is moved aside
  // without deletion, and restored immediately if activation fails.
  const previous=resolve(dirname(dataRoot),'.tuerwache-previous-'+randomUUID());
  if(dirname(previous)!==dirname(dataRoot))throw Error('Unsicheres Wiederherstellungsziel.');
  let hadData=true;
  try{await rename(dataRoot,previous);}catch(error){if(error.code==='ENOENT')hadData=false;else throw error;}
  try{await rename(stagedData,dataRoot);}catch(error){if(hadData)await rename(previous,dataRoot);throw Error('Aktivierung fehlgeschlagen; vorherige Daten wurden erhalten. Ziel muss einen verschiebbaren Datenunterordner verwenden.');}
  await unlink(join(activationRoot,'verification.json'));await rmdir(activationRoot);
  return {restored:true,files:proof.files.length,previousData:hadData?previous:null,reloginRequired:true};
}
async function running(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});const finish=value=>{socket.destroy();resolve(value);};socket.setTimeout(1000,()=>finish(true));socket.on('connect',()=>finish(true));socket.on('error',error=>finish(error.code!=='ECONNREFUSED'));});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const env=parseEnv(await readFile(join(project,'.env'),'utf8'));for(const [key,value]of Object.entries(env))if(process.env[key]===undefined)process.env[key]=value;}catch(error){if(error.code!=='ENOENT')throw error;}
  const args=process.argv.slice(2),id=args[args.indexOf('--verification')+1];
  if(!args.includes('--verification')||!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Usage: node scripts/restore.mjs --verification UUID [--apply]');
  const backupRoot=resolve(process.env.BACKUP_DIRECTORY||join(project,'backups','snapshots'));
  console.log(JSON.stringify(await restoreVerified({projectRoot:project,staging:join(backupRoot,'.restore',id),dataRoot:resolve(process.env.DATA_DIRECTORY||join(project,'data')),apply:args.includes('--apply'),serverRunning:()=>running(Number(process.env.PORT)||3210)}),null,2));
}
