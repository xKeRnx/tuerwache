import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportRepository } from '../scripts/prepare-repository.mjs';
import { renderMarkdown } from '../scripts/build-docs.mjs';
import { createLocalServer } from '../src/server.mjs';
import { cleanTestDirectory } from './helpers.mjs';
import { request as httpRequest } from 'node:http';

test('Repository export excludes runtime/secrets/nested Git and refuses overwrite', async t => {
  const root=await mkdtemp(join(tmpdir(),'tuerwache-export-'));t.after(()=>cleanTestDirectory(root));
  const source=join(root,'source'),destination=join(root,'export');
  for(const [name,content] of Object.entries({'package.json':'{}','.env':'secret','.env.example':'HOST=127.0.0.1','src/server.mjs':'// source','src/private.key':'secret','data/accounts.json':'secret','backups/data.json':'secret','ai/models/yunet.onnx':'weights','ai/models/yunet-LICENSE':'license','mobile/.git/config':'secret','mobile/.env':'secret','mobile/.env.example':'EXAMPLE=1','mobile/src/App.tsx':'// app','mobile/android/build/key.keystore':'secret'})){
    const path=join(source,name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,content);
  }
  const files=await exportRepository(source,destination);
  assert.deepEqual(files.sort(),['.env.example','ai/models/yunet-LICENSE','mobile/.env.example','mobile/src/App.tsx','package.json','src/server.mjs'].sort());
  await assert.rejects(exportRepository(source,destination),/empty/);assert.equal(await readFile(join(destination,'src/server.mjs'),'utf8'),'// source');
  await assert.rejects(exportRepository(source,join(source,'nested')),/outside/);
});

test('Documentation escapes HTML, limits links and is served without exposing source or data', async t => {
  const html=renderMarkdown('# Test\n\n<script>alert(1)</script>\n\n[bad](javascript:alert) [guide](linux.md)\n\n```html\n<img src=x>\n```');
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/href="#linux"/);assert.match(html,/&lt;img/);
  const server=createLocalServer({storage:{clips:tmpdir()},events:[],state:()=>({events:[],cameras:[]})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const url='http://127.0.0.1:'+server.address().port;
  const response=await fetch(url+'/docs');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  const body=await response.text();assert.equal((body.match(/<article /g)||[]).length,20);assert.ok(body.includes('data-language-button="en"'));
  assert.match(body, /href="\/"[^>]+>Zur App/);
  const app = await (await fetch(url + '/')).text();
  assert.match(app, /<a href="\/docs" class="text-button">Dokumentation<\/a>/);
  const navigationStatus=await new Promise((resolve,reject)=>{const request=httpRequest(url+'/docs',{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});
  assert.equal(navigationStatus,200);
  for(const path of ['/docs.js','/docs.css','/docs-media/onvif-search.webp','/docs-media/rtsp-setup.webp','/docs-media/onvif-search-en.webp','/docs-media/rtsp-setup-en.webp'])assert.equal((await fetch(url+path)).status,200);
  for(const path of ['/docs/operations.md','/data/accounts.json','/.env','/scripts/install-linux.sh'])assert.equal((await fetch(url+path)).status,404);
});
