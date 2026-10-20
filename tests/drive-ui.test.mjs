import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {initDrive} from '../src/drive-ui.js';import {DriveSync} from '../src/drive-sync.js';import {DRIVE_SCOPE} from '../src/drive-client.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(saved){
 const {document,window}=parseHTML('<html><body><button id="drive-indicator" hidden></button><div id="panel"></div></body></html>');const values=new Map(Object.entries(saved));const requests=[];let config,fail=false;
 const env={document,window,AbortController,setTimeout,clearTimeout,setInterval:()=>0,fetch:async()=>Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}}),google:{accounts:{oauth2:{hasGrantedAllScopes:r=>r.scope===DRIVE_SCOPE,initTokenClient:cfg=>{if(fail)throw Error('Google no disponible');config=cfg;return {requestAccessToken:options=>{requests.push(options);queueMicrotask(()=>cfg.callback({access_token:'token',scope:DRIVE_SCOPE,expires_in:3600}));}};}}}}};
 const store={getSetting:async(k,fallback)=>values.has(k)?values.get(k):fallback,setSetting:async(k,v)=>values.set(k,v),addEventListener(){}};
 const errors=[];const ui=initDrive({store,env,isBusy:()=>false,onApplied:async()=>{},utility:(_,html)=>document.getElementById('panel').innerHTML=html,closeUtility(){},showError:e=>errors.push(e)});
 return {ui,document,values,requests,errors,fail:value=>fail=value,config:()=>config};
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
