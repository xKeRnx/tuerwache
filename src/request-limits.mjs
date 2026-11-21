export class RequestLimits{
  constructor(){this.windows=new Map();}
  allow(key,limit,now=Date.now()){
    let window=this.windows.get(key);if(!window||window.until<=now){window={until:now+60000,count:0};this.windows.delete(key);this.windows.set(key,window);}
    while(this.windows.size>10000)this.windows.delete(this.windows.keys().next().value);
    return ++window.count<=limit;
  }
}
