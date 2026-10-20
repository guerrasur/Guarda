// Best-effort, one-use handoff across a reload or application update. Only the tab's
// random ID enters sessionStorage; the access token stays in worker RAM.
export class DriveSessionBridge {
 constructor({env=globalThis}={}) { this.env=env;this.key=null; }
 tabKey() {
  if(this.key)return this.key;
  try {
   const storage=this.env.sessionStorage,name='guarda-drive-tab';
   const saved=storage.getItem(name);
   if(/^[a-f0-9-]{32,64}$/.test(saved||''))return this.key=saved;
   const id=this.env.crypto.randomUUID();storage.setItem(name,id);return this.key=id;
  } catch { return null; }
 }
 exchange(action,session) {
  const worker=this.env.navigator?.serviceWorker?.controller,key=this.tabKey();
  if(!worker||!key||!this.env.MessageChannel)return Promise.resolve(null);
  return new Promise(resolve=>{
   const channel=new this.env.MessageChannel();let done=false;
   const finish=value=>{if(done)return;done=true;this.env.clearTimeout(timer);channel.port1.close();resolve(value);};
   const timer=this.env.setTimeout(()=>finish(null),1200);
   channel.port1.onmessage=event=>finish(event.data);
   try{worker.postMessage({type:'DRIVE_SESSION',action,key,...(session?{session}:{})},[channel.port2]);}catch{finish(null);}
  });
 }
 async offer(session) { return (await this.exchange('offer',session))?.ok===true; }
 async take() { return (await this.exchange('take'))?.session||null; }
 clear() { return this.exchange('clear'); }
}
