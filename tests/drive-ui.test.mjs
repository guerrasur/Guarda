import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {initDrive} from '../src/drive-ui.js';import {DriveSync,SyncDeferredError} from '../src/drive-sync.js';import {DRIVE_SCOPE} from '../src/drive-client.js';
import {DriveSessionBridge} from '../src/drive-session.js';import {GOOGLE_CLIENT_ID} from '../src/drive-config.js';
import {brokerFixture} from './helpers/drive-broker.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(saved,options={}){
 const {document,window}=parseHTML('<html><body><button id="drive-indicator" hidden></button><div id="panel"></div></body></html>');const values=new Map(Object.entries(saved));const requests=[];let config,fail=false,onChange,busy=false,retry,retryDelay,closed=0;
 const env={document,window,crypto,navigator:{onLine:true},AbortController,setTimeout:(fn,ms)=>{if(ms<90000){retry=fn;retryDelay=ms;return 0;}return setTimeout(fn,ms);},clearTimeout:id=>{if(id===0)retry=null;else clearTimeout(id);},setInterval:()=>0,fetch:async()=>Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}}),google:{accounts:{oauth2:{hasGrantedAllScopes:r=>r.scope===DRIVE_SCOPE,initTokenClient:cfg=>{if(fail)throw Error('Google no disponible');config=cfg;return {requestAccessToken:oauthOptions=>{requests.push(oauthOptions);queueMicrotask(()=>options.authorize?options.authorize(cfg):cfg.callback({access_token:'token',scope:DRIVE_SCOPE,expires_in:3600}));}};}}}}};
 Object.assign(env,options.env);
 const store={getSetting:async(k,fallback)=>values.has(k)?values.get(k):fallback,setSetting:async(k,v)=>values.set(k,v),addEventListener:(_,fn)=>onChange=fn};
 const errors=[];const ui=initDrive({store,env,brokerUrl:options.brokerUrl??'',isBusy:()=>busy,onApplied:async()=>{},utility:(_,html)=>document.getElementById('panel').innerHTML=html,closeUtility(){closed++;},showError:e=>errors.push(e)});
 return {ui,env,document,get closed(){return closed;},get retryDelay(){return retryDelay;},get hasRetry(){return !!retry;},values,requests,errors,setBusy:value=>busy=value,retry:()=>{const fn=retry;retry=null;return fn?.();},fail:value=>fail=value,config:()=>config,change:(type='note')=>onChange({detail:{type,id:type==='setting'?'theme':'note'}})};
}
test('previously linked Drive shows reconnect after reload, renews with account hint and remembers explicit disconnect',async()=>{
 const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{
 const f=fixture({'drive-bound-account':'owner','drive-connection':{enabled:true,user:{permissionId:'owner',emailAddress:'owner@example.test'}}});await settle();const badge=f.document.getElementById('drive-indicator');assert.equal(badge.hidden,false);assert.equal(badge.dataset.state,'reconnect');assert.equal(f.requests.length,0);
 await f.ui.open();await settle();const connect=f.document.getElementById('drive-connect');assert.match(connect.textContent,/Reconectar/);connect.onclick();await settle();await settle();assert.deepEqual(f.requests,[{prompt:'',login_hint:'owner@example.test'}]);assert.equal(badge.dataset.state,'synced');assert.equal(f.values.get('drive-connection').enabled,true);
 await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();assert.equal(badge.hidden,true);assert.equal(f.values.get('drive-connection').enabled,false);
 }finally{DriveSync.prototype.sync=original;}
});
test('failed Google initialization leaves a usable retry button without opening a popup outside a click',async()=>{
 const f=fixture({});f.fail(true);await f.ui.open();await settle();let connect=f.document.getElementById('drive-connect');assert.equal(connect.disabled,false);assert.match(connect.textContent,/Reintentar/);f.fail(false);connect.onclick();await settle();assert.equal(connect.disabled,false);assert.equal(f.requests.length,0);assert.match(f.document.getElementById('drive-panel-status').textContent,/Conexión lista/);
});
test('legacy bound accounts are recognized after reload without storing access tokens',async()=>{
 const f=fixture({'drive-bound-account':'owner'});await settle();assert.equal(f.document.getElementById('drive-indicator').hidden,false);await f.ui.open();await settle();assert.match(f.document.getElementById('drive-connect').textContent,/Reconectar/);assert.equal(f.requests.length,0);
});

test('profile ring clears green for pending edits and never reports an in-flight stale snapshot as saved',async()=>{
 const original=DriveSync.prototype.sync;let finish;DriveSync.prototype.sync=()=>new Promise(resolve=>finish=resolve);
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();
  const badge=f.document.getElementById('drive-indicator');assert.equal(badge.dataset.state,'syncing');assert.equal(f.ui.getState().connected,true);
  f.change();assert.equal(badge.dataset.state,'pending');finish({});await settle();assert.equal(badge.dataset.state,'pending');
  const saved=f.ui.sync();assert.equal(badge.dataset.state,'syncing');finish({});await saved;assert.equal(badge.dataset.state,'synced');assert.equal(badge.textContent,'');
  f.ui.markPending();assert.equal(badge.dataset.state,'pending');
  await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();assert.equal(f.ui.getState().enabled,false);
 }finally{DriveSync.prototype.sync=original;}
});

test('opening a note during sync queues an automatic retry without disconnecting or turning the ring red',async()=>{
 const original=DriveSync.prototype.sync;let failNext=false;DriveSync.prototype.sync=async()=>{if(failNext){failNext=false;throw new SyncDeferredError('La nota abierta se conserva.');}return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();
  failNext=true;await f.ui.sync();assert.equal(f.ui.getState().connected,true);assert.equal(f.ui.getState().state,'pending');assert.equal(f.errors.length,0);assert.match(f.ui.getState().message,/conectado/);
  f.setBusy(true);await f.retry();assert.equal(f.ui.getState().state,'pending');f.setBusy(false);f.ui.resume();await f.retry();assert.equal(f.ui.getState().state,'synced');assert.equal(f.requests.length,1,'no new OAuth request for an interrupted sync');
  await f.ui.open();await settle();assert.match(f.document.getElementById('drive-connect').textContent,/Renovar conexión/);await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;}
});
test('local revision races are pending, while real network failures retain their error state',async()=>{
 const original=DriveSync.prototype.sync;let failure;DriveSync.prototype.sync=async()=>{if(failure)throw failure;return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();
  failure=new Error('storage wrapper',{cause:Object.assign(new Error('changed'),{code:'SYNC_LOCAL_CHANGED'})});await f.ui.sync();assert.equal(f.ui.getState().state,'pending');failure=null;await f.retry();assert.equal(f.ui.getState().state,'synced');
  failure=new Error('Sin conexión a internet');await assert.rejects(f.ui.sync(),/Sin conexión/);assert.equal(f.ui.getState().state,'error');assert.equal(f.ui.getState().connected,true);
  await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;}
});
test('concurrent sync requests share one cycle and controls recover when it finishes',async()=>{
 const original=DriveSync.prototype.sync;let finish,calls=0;DriveSync.prototype.sync=async()=>({});
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();
  DriveSync.prototype.sync=()=>{calls++;return new Promise(resolve=>finish=resolve);};
  const a=f.ui.sync(),b=f.ui.sync();assert.equal(a,b);assert.equal(calls,1);await f.ui.open();assert.equal(f.document.getElementById('drive-sync-now').disabled,true);assert.equal(f.document.getElementById('drive-disconnect').disabled,true);
  f.change();finish({});await a;assert.equal(f.ui.getState().state,'pending');assert.equal(f.document.getElementById('drive-sync-now').disabled,false);assert.equal(f.document.getElementById('drive-disconnect').disabled,false);
  await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;}
});
test('offline changes wait without network requests and recover on the online event',async()=>{
 const original=DriveSync.prototype.sync,oldNow=Date.now;let time=oldNow();Date.now=()=>time;let calls=0;DriveSync.prototype.sync=async()=>{calls++;return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();const before=calls;
  f.env.navigator.onLine=false;f.env.window.dispatchEvent(new f.env.window.Event('offline'));f.change();await f.ui.sync();assert.equal(f.ui.getState().state,'offline');assert.equal(calls,before);assert.equal(f.ui.getState().connected,true);
  time+=3000;f.env.navigator.onLine=true;f.env.window.dispatchEvent(new f.env.window.Event('online'));await settle();assert.equal(f.ui.getState().state,'synced');assert.equal(calls,before+1);assert.equal(f.requests.length,1);
  await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;Date.now=oldNow;}
});
test('temporary Drive errors retry with backoff while permanent errors do not loop',async()=>{
 const original=DriveSync.prototype.sync;let failure;DriveSync.prototype.sync=async()=>{if(failure)throw failure;return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();
  failure=Object.assign(Error('Drive ocupado'),{code:'DRIVE_RETRYABLE'});await assert.rejects(f.ui.sync());assert.equal(f.ui.getState().state,'pending');assert.ok(f.retryDelay>=3000&&f.retryDelay<3750);await f.retry();assert.ok(f.retryDelay>=6000&&f.retryDelay<7500);failure=null;await f.retry();assert.equal(f.ui.getState().state,'synced');
  failure=Object.assign(Error('Permiso insuficiente'),{code:'DRIVE_PERMISSION'});await assert.rejects(f.ui.sync());assert.equal(f.ui.getState().state,'error');assert.equal(f.hasRetry,false);
  await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;}
});
test('reading a note pauses retries until resume and local appearance settings do not trigger cloud changes',async()=>{
 const original=DriveSync.prototype.sync;let calls=0;DriveSync.prototype.sync=async()=>{calls++;return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();f.change('setting');assert.equal(f.ui.getState().state,'synced');assert.equal(f.hasRetry,false);
  f.setBusy(true);await f.ui.sync();assert.equal(f.hasRetry,false);const before=calls;f.setBusy(false);f.ui.resume();await f.retry();assert.equal(calls,before+1);assert.equal(f.ui.getState().state,'synced');
  await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;}
});

test('updating hands off the verified session, flushes pending edits and restores without another OAuth prompt',async()=>{
 const originalSync=DriveSync.prototype.sync,originalTake=DriveSessionBridge.prototype.take,originalOffer=DriveSessionBridge.prototype.offer;
 let handoff=null,calls=0;DriveSync.prototype.sync=async()=>{calls++;return {};};DriveSessionBridge.prototype.take=async()=>{const session=handoff;handoff=null;return session;};DriveSessionBridge.prototype.offer=async session=>{handoff=structuredClone(session);return true;};
 try{
  const first=fixture({});await first.ui.open();await settle();await first.ui.connect();assert.equal(first.requests.length,1);
  first.change();const before=calls;assert.equal(await first.ui.prepareReload(),true);assert.equal(calls,before+1);assert.equal(handoff.clientId,GOOGLE_CLIENT_ID);
  const next=fixture(Object.fromEntries(first.values));for(let i=0;i<4;i++)await settle();assert.equal(next.ui.getState().connected,true);assert.equal(next.ui.getState().state,'synced');assert.equal(next.requests.length,0);
  assert.doesNotMatch(JSON.stringify([...next.values]),/access_token|"token"|"expires"/);assert.equal(handoff.user.permissionId,'owner');
 }finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.take=originalTake;DriveSessionBridge.prototype.offer=originalOffer;}
});
test('transient identification failures retry with the already authorized token',async()=>{
 const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{
  const f=fixture({});await f.ui.open();await settle();f.env.fetch=async()=>{throw new TypeError('Network lost after consent');};
  await assert.rejects(f.ui.connect(),error=>error.code==='DRIVE_RETRYABLE');assert.equal(f.ui.getState().state,'pending');assert.equal(f.requests.length,1);
  f.env.fetch=async()=>Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}});await f.retry();assert.equal(f.ui.getState().connected,true);assert.equal(f.ui.getState().state,'synced');assert.equal(f.requests.length,1);assert.equal(f.values.get('drive-connection').enabled,true);
 }finally{DriveSync.prototype.sync=original;}
});
test('an invalid update handoff never uploads or opens Google without a user gesture',async()=>{
 const originalSync=DriveSync.prototype.sync,originalTake=DriveSessionBridge.prototype.take;let calls=0;
 DriveSync.prototype.sync=async()=>{calls++;return {};};DriveSessionBridge.prototype.take=async()=>({clientId:GOOGLE_CLIENT_ID,token:'other-account-token',expires:Date.now()+3500000,user:{permissionId:'other'}});
 try{
  const f=fixture({'drive-bound-account':'owner','drive-connection':{enabled:true,user:{permissionId:'owner',emailAddress:'owner@example.test'}}});for(let i=0;i<3;i++)await settle();
  assert.equal(f.ui.getState().connected,false);assert.equal(f.ui.getState().state,'reconnect');assert.equal(calls,0);assert.equal(f.requests.length,0);
 }finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.take=originalTake;}
});
test('concurrent Google preparation waits for one initialization before enabling connection',async()=>{
 const f=fixture({}),google=f.env.google;delete f.env.google;
 const first=f.ui.prepare(),second=f.ui.prepare();assert.equal(first,second);assert.equal(f.ui.getState().preparing,true);
 const script=f.document.querySelector('script');assert.ok(script);assert.equal(f.document.querySelectorAll('script').length,1);
 f.env.google=google;script.onload();await Promise.all([first,second]);assert.equal(f.ui.getState().preparing,false);assert.equal(f.requests.length,0);
});

test('linked account renews on first trusted interaction and synchronizes without the settings panel',async()=>{
 const original=DriveSync.prototype.sync;let calls=0;DriveSync.prototype.sync=async()=>{calls++;return {};};
 try{
  const f=fixture({'drive-bound-account':'owner','drive-connection':{enabled:true,user:{permissionId:'owner',emailAddress:'owner@example.test'}}});await settle();
  f.document.dispatchEvent(new f.env.window.Event('pointerup'));await settle();assert.equal(f.requests.length,0,'synthetic events cannot open Google');
  gesture(f);await settle();await settle();
  assert.equal(f.requests.length,1);assert.equal(calls,1);assert.equal(f.ui.getState().state,'synced');
 }finally{DriveSync.prototype.sync=original;}
});
test('ordinary pagehide preserves a verified session in worker memory',async()=>{
 const originalSync=DriveSync.prototype.sync,originalOffer=DriveSessionBridge.prototype.offer;let offers=0;
 DriveSync.prototype.sync=async()=>({});DriveSessionBridge.prototype.offer=async()=>{offers++;return true;};
 try{const f=fixture({});await f.ui.open();await settle();await f.ui.connect();const before=offers;f.env.window.dispatchEvent(new f.env.window.Event('pagehide'));await settle();assert.equal(offers,before+1);assert.doesNotMatch(JSON.stringify([...f.values]),/"token"/);}
 finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.offer=originalOffer;}
});

const linked={'drive-bound-account':'owner','drive-connection':{enabled:true,user:{permissionId:'owner',emailAddress:'owner@example.test'}}};
function gesture(f,target=f.document.body){
 // Simulated trusted events; this does not exercise Safari user activation.
 for(const type of ['pointerup','click']){const event=new f.env.window.Event(type,{bubbles:true});Object.defineProperty(event,'isTrusted',{value:true});target.dispatchEvent(event);}
}
test('automatic renewal waits while editing and ignores editable, dialog and action surfaces',async()=>{
 const f=fixture(linked);await settle();f.setBusy(true);gesture(f);await settle();assert.equal(f.requests.length,0);
 f.setBusy(false);
 for(const html of ['<div contenteditable="true"><span>text</span></div>','<dialog open><p>dialog</p></dialog>','<article data-note="1"><span>note</span></article>','<button>button</button>','<input>']){
  const root=f.document.createElement('div');root.innerHTML=html;f.document.body.append(root);gesture(f,root.querySelector('span,p')||root.firstElementChild);await settle();assert.equal(f.requests.length,0,html);root.remove();
 }
});
test('automatic renewal does not close another dialog and uses no-consent mode',async()=>{
 const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{const f=fixture(linked);await settle();gesture(f);await settle();await settle();assert.equal(f.ui.getState().connected,true);assert.equal(f.closed,0);assert.deepEqual(f.requests,[{prompt:'none',login_hint:'owner@example.test'}]);}
 finally{DriveSync.prototype.sync=original;}
});
test('a mismatched account cannot trigger repeated automatic authorization or uploads',async()=>{
 const original=DriveSync.prototype.sync;let syncs=0;DriveSync.prototype.sync=async()=>{syncs++;return {};};
 try{const f=fixture(linked);await settle();f.env.fetch=async()=>Response.json({user:{permissionId:'other',emailAddress:'other@example.test'}});
  gesture(f);await settle();await settle();assert.equal(f.ui.getState().connected,false);assert.equal(syncs,0);assert.equal(f.values.get('drive-connection').user.permissionId,'owner');
  gesture(f);await settle();assert.equal(f.requests.length,1);assert.match(f.ui.getState().message,/otra cuenta/);
 }finally{DriveSync.prototype.sync=original;}
});
test('cancelling manual authorization prevents automatic popups until an explicit retry',async()=>{
 let cancel=true;const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{const f=fixture(linked,{authorize:cfg=>cancel?cfg.error_callback({type:'popup_closed'}):cfg.callback({access_token:'token',scope:DRIVE_SCOPE,expires_in:3600})});await settle();
  await assert.rejects(f.ui.connect());gesture(f);await settle();assert.equal(f.requests.length,1);
  cancel=false;await f.ui.connect();assert.equal(f.ui.getState().state,'synced');
 }finally{DriveSync.prototype.sync=original;}
});
test('a failed Google script initialization retries when connectivity returns',async()=>{
 const f=fixture(linked);f.fail(true);await settle();assert.equal(f.ui.getState().preparing,false);f.fail(false);
 f.env.window.dispatchEvent(new f.env.window.Event('online'));await settle();assert.equal(f.ui.getState().preparing,false);
 const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{gesture(f);await settle();await settle();assert.equal(f.requests.length,1);assert.equal(f.ui.getState().connected,true);}finally{DriveSync.prototype.sync=original;}
});
test('a pending reload recovery is checked before any automatic authorization',async()=>{
 const originalSync=DriveSync.prototype.sync,originalTake=DriveSessionBridge.prototype.take;let release;
 DriveSync.prototype.sync=async()=>({});DriveSessionBridge.prototype.take=()=>new Promise(resolve=>release=resolve);
 try{const f=fixture(linked);await settle();gesture(f);await settle();assert.equal(f.requests.length,0);
  release({clientId:GOOGLE_CLIENT_ID,token:'handoff',expires:Date.now()+3500000,user:{permissionId:'owner'}});await settle();await settle();assert.equal(f.ui.getState().connected,true);assert.equal(f.requests.length,0);
 }finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.take=originalTake;}
});
test('disconnect disables automatic renewal before waiting for worker cleanup',async()=>{
 const originalSync=DriveSync.prototype.sync,originalClear=DriveSessionBridge.prototype.clear;let release;
 DriveSync.prototype.sync=async()=>({});
 try{const f=fixture(linked);await settle();await f.ui.connect();await f.ui.open();
  DriveSessionBridge.prototype.clear=()=>new Promise(resolve=>release=resolve);
  const done=f.document.getElementById('drive-disconnect').onclick();await settle();gesture(f);await settle();assert.equal(f.ui.getState().enabled,false);assert.equal(f.requests.length,1);release();await done;
 }finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.clear=originalClear;}
});
test('Google requiring interaction stops automatic retries and still allows manual reconnection',async()=>{
 let interactive=false;const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{const f=fixture(linked,{authorize:cfg=>cfg.callback(interactive?{access_token:'token',scope:DRIVE_SCOPE,expires_in:3600}:{error:'login_required'})});await settle();
  gesture(f);await settle();assert.equal(f.requests.length,1);assert.match(f.ui.getState().message,/confirmación/);
  gesture(f);await f.ui.sync();gesture(f);await settle();assert.equal(f.requests.length,1);assert.equal(f.values.get('drive-connection').enabled,true);
  interactive=true;await f.ui.connect();assert.equal(f.ui.getState().state,'synced');assert.equal(f.requests[1].prompt,'');
 }finally{DriveSync.prototype.sync=original;}
});
test('an editor opened during renewal is preserved and synchronization waits for it to close',async()=>{
 let authorize;const original=DriveSync.prototype.sync;let calls=0;DriveSync.prototype.sync=async()=>{calls++;return {};};
 try{const f=fixture(linked,{authorize:cfg=>authorize=cfg});await settle();gesture(f);await settle();f.setBusy(true);
  authorize.callback({access_token:'token',scope:DRIVE_SCOPE,expires_in:3600});await settle();await settle();
  assert.equal(f.ui.getState().connected,true);assert.equal(f.ui.getState().state,'pending');assert.equal(f.closed,0);assert.equal(calls,0);
  f.setBusy(false);f.ui.resume();await f.retry();assert.equal(calls,1);assert.equal(f.ui.getState().state,'synced');
 }finally{DriveSync.prototype.sync=original;}
});
test('offline reload restores the same session when internet returns without a popup',async()=>{
 const originalSync=DriveSync.prototype.sync,originalTake=DriveSessionBridge.prototype.take;let calls=0;
 DriveSync.prototype.sync=async()=>{calls++;return {};};DriveSessionBridge.prototype.take=async()=>({clientId:GOOGLE_CLIENT_ID,token:'handoff',expires:Date.now()+3500000,user:{permissionId:'owner'}});
 try{const f=fixture(linked);f.env.navigator.onLine=false;await settle();gesture(f);await settle();assert.equal(f.requests.length,0);assert.equal(calls,0);
  f.env.navigator.onLine=true;f.env.window.dispatchEvent(new f.env.window.Event('online'));await settle();await settle();assert.equal(calls,1);assert.equal(f.requests.length,0);assert.equal(f.ui.getState().state,'synced');
 }finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.take=originalTake;}
});
test('a revoked token is removed from worker memory instead of restored again on reload',async()=>{
 const originalSync=DriveSync.prototype.sync,originalOffer=DriveSessionBridge.prototype.offer,originalClear=DriveSessionBridge.prototype.clear;let handoff=null;
 DriveSync.prototype.sync=async function(){await this.client.listSnapshots();return {};};
 DriveSessionBridge.prototype.offer=async session=>{handoff=session;return true;};DriveSessionBridge.prototype.clear=async()=>{handoff=null;};
 try{const f=fixture(linked);await settle();f.env.fetch=async url=>url.includes('about?')?Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}}):new Response(null,{status:401});
  await assert.rejects(f.ui.connect(),error=>error.code==='DRIVE_AUTH');assert.equal(handoff,null);assert.equal(f.ui.getState().connected,false);assert.equal(f.ui.getState().state,'reconnect');
 }finally{DriveSync.prototype.sync=originalSync;DriveSessionBridge.prototype.offer=originalOffer;DriveSessionBridge.prototype.clear=originalClear;}
});
test('an explicitly disconnected device never reconnects from clicks or lifecycle events',async()=>{
 const f=fixture({...linked,'drive-connection':{enabled:false}});await settle();gesture(f);
 f.env.window.dispatchEvent(new f.env.window.Event('online'));f.env.document.dispatchEvent(new f.env.window.Event('visibilitychange'));await settle();
 assert.equal(f.requests.length,0);assert.equal(f.ui.getState().enabled,false);assert.equal(f.ui.getState().state,'hidden');
});
test('persistent Drive restores and synchronizes on startup without clicks, OAuth scripts or worker handoff',async t=>{
 const broker=await brokerFixture(t), authorization=await broker.authorize(), original=DriveSync.prototype.sync;let syncs=0;
 DriveSync.prototype.sync=async function(){assert.equal(this.client.user.permissionId,'owner');syncs++;this.onStatus('Todo guardado en Google Drive');return {};};
 try{
  const f=fixture({...linked,'drive-broker-session':{broker:broker.env.PUBLIC_ORIGIN,clientId:GOOGLE_CLIENT_ID,session:authorization.session,accountId:'owner'}},{brokerUrl:broker.env.PUBLIC_ORIGIN,env:{fetch:async(url,options)=>broker.worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:broker.env.APP_ORIGIN}}),broker.env)}});
  for(let i=0;i<100&&!f.ui.getState().connected;i++)await new Promise(resolve=>setTimeout(resolve,2));await settle();
  assert.equal(f.ui.getState().state,'synced');assert.equal(syncs,1);assert.equal(f.requests.length,0);assert.equal(f.document.querySelectorAll('script').length,0);
  await f.ui.open();assert.match(f.document.getElementById('drive-panel-status').textContent,/Sincroniz|guardad/i);
  await f.document.getElementById('drive-disconnect').onclick();assert.equal(f.values.get('drive-broker-session'),null);assert.equal(f.ui.getState().enabled,false);
  f.env.window.dispatchEvent(new f.env.window.Event('online'));await settle();assert.equal(f.ui.getState().enabled,false);assert.equal(syncs,1);
 }finally{DriveSync.prototype.sync=original;}
});
test('persistent migration waits for one explicit authorization and never hijacks board clicks',async t=>{
 const broker=await brokerFixture(t);
 const f=fixture(linked,{brokerUrl:broker.env.PUBLIC_ORIGIN,env:{fetch:async(url,options)=>broker.worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:broker.env.APP_ORIGIN}}),broker.env)}});
 for(let i=0;i<100&&f.ui.getState().state!=='reconnect';i++)await new Promise(resolve=>setTimeout(resolve,2));
 gesture(f);await settle();assert.equal(f.requests.length,0);assert.equal(f.ui.getState().state,'reconnect');assert.match(f.ui.getState().message,/una vez/);
});
test('a pending persistent authorization can be disconnected from the Drive panel',async t=>{
 const broker=await brokerFixture(t);
 const f=fixture({},{brokerUrl:broker.env.PUBLIC_ORIGIN,env:{open:()=>({closed:true,close(){}}),fetch:async(url,options)=>broker.worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:broker.env.APP_ORIGIN}}),broker.env)}});
 await f.ui.open();
 for(let i=0;i<100&&f.ui.getState().preparing;i++)await new Promise(resolve=>setTimeout(resolve,2));
 const result=f.ui.connect().catch(error=>error);
 await settle();await f.ui.open();
 assert.equal(f.document.getElementById('drive-connect').disabled,true);
 assert.equal(f.document.getElementById('drive-disconnect').disabled,false);
 await f.document.getElementById('drive-disconnect').onclick();
 assert.equal((await result).code,'DRIVE_AUTH');
 assert.equal(f.ui.getState().working,false);
 assert.equal(f.ui.getState().enabled,false);
 assert.equal(f.values.get('drive-broker-session'),null);
 assert.equal(f.values.get('drive-connection').enabled,false);
});

test('background failures stop after eight attempts and explicit retry can recover',async()=>{
 const original=DriveSync.prototype.sync;let failure=false,calls=0;
 DriveSync.prototype.sync=async()=>{calls++;if(failure)throw Object.assign(Error('Mantenimiento temporal'),{code:'DRIVE_MAINTENANCE',retryAfterMs:60000});return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();
  failure=true;await assert.rejects(f.ui.sync());
  for(let i=0;i<7;i++){assert.ok(f.retryDelay>=60000);await f.retry();}
  assert.equal(f.hasRetry,false);assert.match(f.ui.getState().message,/pausaron los reintentos/);
  const before=calls;await f.ui.resume();assert.equal(calls,before);
  failure=false;await f.ui.sync();assert.equal(f.ui.getState().state,'synced');
  await f.ui.open();await settle();await f.document.getElementById('drive-disconnect').onclick();
 }finally{DriveSync.prototype.sync=original;}
});
test('every edit restarts the three second upload wait and foreground checks respect the pause',async()=>{
 const original=DriveSync.prototype.sync,oldNow=Date.now;let calls=0,time=100000;Date.now=()=>time;DriveSync.prototype.sync=async()=>{calls++;return {};};
 try{
  const f=fixture({});await f.ui.open();await settle();f.document.getElementById('drive-connect').onclick();await settle();await settle();const before=calls;
  f.ui.markPending();assert.equal(f.retryDelay,3000);time+=2000;f.ui.markPending();assert.equal(f.retryDelay,3000);
  time+=500;f.env.document.dispatchEvent(new f.env.window.Event('visibilitychange'));await settle();assert.equal(calls,before);assert.equal(f.retryDelay,2500);
  time+=2500;await f.retry();assert.equal(calls,before+1);assert.equal(f.ui.getState().state,'synced');
 }finally{DriveSync.prototype.sync=original;Date.now=oldNow;}
});
