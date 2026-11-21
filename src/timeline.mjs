export function timelinePage(events,{cameraId='',from='',to='',kind='',cursor='',limit=48}={}){
  const lower=from?Date.parse(from):-Infinity,upper=to?Date.parse(to):Infinity;
  if(Number.isNaN(lower)||Number.isNaN(upper)||lower>=upper)throw new Error('Gültigen Zeitraum auswählen.');
  if(!['','clip','ding','motion','person'].includes(kind))throw new Error('Ereignisfilter ungültig.');
  const recorded=new Set(events.filter(e=>e.type==='clip'&&['ready','recording','error','expired'].includes(e.status)).flatMap(e=>e.sourceEventIds||[e.sourceEventId]).filter(Boolean));
  const entries=events.filter(e=>['clip','ding','motion'].includes(e.type)&&!recorded.has(e.id)&&(!cameraId||e.cameraId===cameraId)&&Date.parse(e.at)>=lower&&Date.parse(e.at)<upper&&(!kind||(kind==='person'?e.ai?.personDetected:kind==='clip'?e.type==='clip':e.type===kind||e.trigger===kind))).toSorted((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const start=cursor?entries.findIndex(e=>e.id===cursor)+1:0;if(cursor&&!start)throw new Error('Zeitstrahl hat sich geändert. Bitte neu laden.');
  const count=Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:48,100)),page=entries.slice(start,start+count);
  return {total:entries.length,items:page.map(({directory,...entry})=>entry),nextCursor:start+count<entries.length?page.at(-1).id:null};
}
