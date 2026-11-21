import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clipPage} from '../src/clip-archive.mjs';
test('Clip-Archiv findet alte Aufnahmen unabhängig von Systemmeldungen, begrenzt Seiten und versteckt Serverpfade',()=>{
  const clips=Array.from({length:55},(_,i)=>({id:String(i),clip:'test.mp4',status:'ready',cameraId:i%2?'door':'side',directory:'private-server-path'}));
  const events=[...Array.from({length:250},()=>({type:'system'})),...clips];
  const first=clipPage(events);assert.equal(first.total,55);assert.equal(first.items.length,24);assert.equal(first.nextCursor,'23');assert.equal(JSON.stringify(first).includes('private-server-path'),false);
  const second=clipPage(events,{cursor:first.nextCursor});assert.equal(second.items[0].id,'24');assert.equal(second.nextCursor,'47');
  const last=clipPage(events,{cursor:second.nextCursor});assert.equal(last.items.length,7);assert.equal(last.nextCursor,null);
  assert.equal(clipPage(events,{cameraId:'door',limit:1000}).total,27);assert.throws(()=>clipPage(events,{cursor:'missing'}));
});
