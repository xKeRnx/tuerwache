import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timelinePage} from '../src/timeline.mjs';
test('Zeitstrahl sortiert Aufnahmen und Ereignisse, vermeidet doppelte Auslöser und filtert Datum/Kamera/Person',()=>{
  const events=[{id:'system',type:'system',at:'2026-11-17T10:00:00Z'},{id:'motion',type:'motion',cameraId:'door',at:'2026-11-17T09:00:00Z'},{id:'clip',type:'clip',trigger:'motion',sourceEventId:'motion',cameraId:'door',at:'2026-11-17T09:00:01Z',clip:'test.mp4',status:'ready',directory:'private-path',summary:{text:'Person geht zur Tür.'},ai:{personDetected:true}},{id:'ding',type:'ding',cameraId:'side',at:'2026-11-16T18:00:00Z'}];
  const all=timelinePage(events);assert.deepEqual(all.items.map(item=>item.id),['clip','ding']);assert.equal(all.total,2);assert.equal(JSON.stringify(all).includes('private-path'),false);assert.equal(all.items[0].summary.text,'Person geht zur Tür.');
  assert.equal(timelinePage(events,{kind:'motion'}).items[0].id,'clip');assert.equal(timelinePage(events,{kind:'person'}).total,1);assert.equal(timelinePage(events,{cameraId:'side'}).total,1);
  assert.equal(timelinePage(events,{from:'2026-11-17T00:00:00Z',to:'2026-11-18T00:00:00Z'}).total,1);
  assert.equal(timelinePage(events,{limit:1}).nextCursor,'clip');assert.equal(timelinePage(events,{cursor:'clip'}).items[0].id,'ding');assert.throws(()=>timelinePage(events,{from:'bad'}));
});
