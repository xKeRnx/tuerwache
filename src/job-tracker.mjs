export class JobTracker extends Set{
  constructor(){super();this.started=new Map();}
  add(key){if(!this.has(key))this.started.set(key,Date.now());return super.add(key);}
  delete(key){this.started.delete(key);return super.delete(key);}
  clear(){this.started.clear();super.clear();}
  state(now=Date.now()){return [...this.started].map(([key,at])=>({key,startedAt:new Date(at).toISOString(),seconds:Math.floor((now-at)/1000)}));}
}
