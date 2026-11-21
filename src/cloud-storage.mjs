import { S3Client, PutObjectCommand, DeleteObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export class CloudStorage {
  constructor(clientFactory = config => new S3Client(config)) { this.clientFactory = clientFactory; }
  client(config) {
    return this.clientFactory({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  }
  async upload(config, entry, path) {
    const key = `${config.prefix}${config.prefix && !config.prefix.endsWith('/') ? '/' : ''}${entry.at.slice(0, 10)}/${entry.clip}`;
    const client = this.client(config); const stream = createReadStream(path);
    try {
      const result = await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: stream, ContentLength: (await stat(path)).size, ContentType: 'video/mp4' }), { abortSignal: AbortSignal.timeout(120_000) });
      return { status: 'uploaded', key, bucket: config.bucket, endpoint: config.endpoint, region: config.region, at: new Date().toISOString(), etag: result.ETag };
    } finally { stream.destroy(); client.destroy(); }
  }
  async remove(config, cloud) {
    if (cloud.endpoint !== config.endpoint || cloud.bucket !== config.bucket || cloud.region !== config.region) throw new Error('Zum Löschen der Cloud-Kopie zuerst den ursprünglichen S3-Endpunkt, die Region und den Bucket einstellen.');
    const client = this.client(config);
    try { await client.send(new DeleteObjectCommand({ Bucket: cloud.bucket, Key: cloud.key }), { abortSignal: AbortSignal.timeout(30_000) }); }
    finally { client.destroy(); }
  }
  async open(config,cloud,range){
    if(cloud.endpoint!==config.endpoint||cloud.bucket!==config.bucket||cloud.region!==config.region||!config.accessKeyId||!config.secretAccessKey)throw Error('Ursprüngliche Cloud-Verbindung zum Lesen dieser Aufnahme einrichten.');
    if(range&&(!/^bytes=\d*-\d*$/.test(range)||range==='bytes=-'))throw Error('Ungültiger Videobereich.');
    const client=this.client(config);
    try{const result=await client.send(new GetObjectCommand({Bucket:cloud.bucket,Key:cloud.key,...(range?{Range:range}:{})}),{abortSignal:AbortSignal.timeout(30000)});return {body:result.Body,length:result.ContentLength,range:result.ContentRange,close:()=>client.destroy()};}catch(error){client.destroy();throw error;}
  }
}
