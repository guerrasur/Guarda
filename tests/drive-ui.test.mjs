import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {initDrive} from '../src/drive-ui.js';import {DriveSync,SyncDeferredError} from '../src/drive-sync.js';import {DRIVE_SCOPE} from '../src/drive-client.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(saved){
 const {document,window}=parseHTML('<html><body><button id="drive-indicator" hidden></button><div id="panel"></div></body></html>');const values=new Map(Object.entries(saved));const requests=[];let config,fail=false,onChange,busy=false,retry;
 const env={document,window,AbortController,setTimeout:(fn,ms)=>{if(ms===1500){retry=fn;return 0;}return setTimeout(fn,ms);},clearTimeout:id=>{if(id===0)retry=null;else clearTimeout(id);},setInterval:()=>0,fetch:async()=>Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}}),google:{accounts:{oauth2:{hasGrantedAllScopes:r=>r.scope===DRIVE_SCOPE,initTokenClient:cfg=>{if(fail)throw Error('Google no disponible');config=cfg;return {requestAccessToken:options=>{requests.push(options);queueMicrotask(()=>cfg.callback({access_token:'token',scope:DRIVE_SCOPE,expires_in:3600}));}};}}}}};
 const store={getSetting:async(k,fallback)=>values.has(k)?values.get(k):fallback,setSetting:async(k,v)=>values.set(k,v),addEventListener:(_,fn)=>onChange=fn};
 const errors=[];const ui=initDrive({store,env,isBusy:()=>busy,onApplied:async()=>{},utility:(_,html)=>document.getElementById('panel').innerHTML=html,closeUtility(){},showError:e=>errors.push(e)});
 return {ui,document,values,requests,errors,setBusy:value=>busy=value,retry:()=>{const fn=retry;retry=null;return fn?.();},fail:value=>fail=value,config:()=>config,change:()=>onChange({detail:{type:'note',id:'note'}})};
}
test('previously linked Drive shows reconnect after reload, renews with account hint and remembers explicit disconnect',async()=>{
 const original=DriveSync.prototype.sync;DriveSync.prototype.sync=async()=>({});
 try{
 const f=fixture({'drive-bound-account':'owner','drive-connection':{enabled:true,user:{permissionId:'owner',emailAddress:'owner@example.test'}}});await settle();const badge=f.document.getElementById('drive-indicator');assert.equal(badge.hidden,false);assert.equal(badge.dataset.state,'error');assert.equal(f.requests.length,0);
 await f.ui.open();await settle();const connect=f.document.getElementById('drive-connect');assert.match(connect.textContent,/Reconectar/);connect.onclick();await settle();await settle();assert.deepEqual(f.requests,[{prompt:'',hint:'owner@example.test'}]);assert.equal(badge.dataset.state,'synced');assert.equal(f.values.get('drive-connection').enabled,true);
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
  f.setBusy(true);await f.retry();assert.equal(f.ui.getState().state,'pending');f.setBusy(false);await f.retry();assert.equal(f.ui.getState().state,'synced');assert.equal(f.requests.length,1,'no new OAuth request for an interrupted sync');
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
