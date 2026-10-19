import test from 'node:test';
import assert from 'node:assert/strict';
import { initUpdater,newer } from '../src/updater.js';
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({candidate='0.3.0',workerVersion=candidate,workerBuild='abc',busy=false,saveFails=false}={}){
 const listeners={},elements=Object.fromEntries(['update','update-status','version'].map(id=>[id,{addEventListener:(name,f)=>listeners[id+name]=f}]));
 const attempts=new Map(),intervals=[],requests=[],messages=[],reloads=[];let saves=0;
 const serviceWorker={controller:{},addEventListener:(name,f)=>listeners[name]=f,register:async()=>registration};
 const worker={postMessage(data,ports){messages.push(data.type);if(data.type==='RELEASE_INFO')queueMicrotask(()=>ports[0].peer.onmessage({data:{version:workerVersion,build:workerBuild}}));}};
 const registration={waiting:worker,update:async()=>{},addEventListener:(name,f)=>listeners[name]=f};
 const env={document:{hidden:false,getElementById:id=>elements[id],addEventListener:(name,f)=>listeners[name]=f},window:{addEventListener:(name,f)=>listeners[name]=f},navigator:{serviceWorker},location:{href:'https://example.test/Guarda/#notes',replace:url=>reloads.push(url)},sessionStorage:{getItem:k=>attempts.get(k),setItem:(k,v)=>attempts.set(k,v),removeItem:k=>attempts.delete(k)},MessageChannel:class{constructor(){this.port1={close(){}};this.port2={peer:this.port1};}},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:f=>intervals.push(f),fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({version:candidate,build:'abc'})};}};
 const updater=initUpdater('0.2.0',{env,isBusy:()=>busy,saveState:async()=>{saves++;if(saveFails)throw Error('Disk full');}});
 return {env,updater,listeners,elements,attempts,requests,messages,reloads,setBusy:v=>busy=v,get saves(){return saves;}};
}
test('numeric versions: equal, older and invalid releases do not trigger updates',async()=>{
 assert.equal(newer('0.10.0','0.9.0'),true);assert.equal(newer('1.0.0','0.99.99'),true);
 for(const candidate of ['0.2.0','0.1.9','bad']){assert.equal(newer(candidate,'0.2.0'),false);const f=fixture({candidate});await settle();assert.deepEqual(f.messages,[]);assert.deepEqual(f.reloads,[]);}
});
test('stages a newer worker and reloads only after controller activation and committed state',async()=>{
 const f=fixture();await settle();assert.deepEqual(f.messages,['RELEASE_INFO','SKIP_WAITING']);assert.equal(f.reloads.length,0);
 f.listeners.controllerchange();await settle();assert.equal(f.reloads.length,1);assert.match(f.reloads[0],/\/Guarda\/\?v=0.3.0#notes/);assert.ok(f.saves>=2);
 assert.equal(f.requests[0].options.cache,'no-store');assert.equal(f.requests[0].url.pathname,'/Guarda/version.json');assert.ok(f.requests[0].url.searchParams.has('t'));
});
test('editing/recording delays both own update and activation from another tab until idle',async()=>{
 const f=fixture({busy:true});await settle();assert.deepEqual(f.messages,[]);assert.match(f.elements['update-status'].textContent,/cierres la nota/);
 f.listeners.controllerchange();await settle();assert.equal(f.reloads.length,0);f.setBusy(false);await f.updater.apply();assert.equal(f.reloads.length,1);
 const g=fixture({busy:true});await settle();g.setBusy(false);await g.updater.apply();assert.deepEqual(g.messages,['RELEASE_INFO','SKIP_WAITING']);
});
test('incomplete deployment, save failure and reload loop guard preserve the running app',async()=>{
 for(const config of [{workerVersion:'0.2.0'},{workerBuild:'old'},{saveFails:true}]){const f=fixture(config);await settle();assert.equal(f.messages.includes('SKIP_WAITING'),false);assert.equal(f.reloads.length,0);}
 const f=fixture();f.attempts.set('guarda-update-attempt','0.3.0');await settle();assert.equal(f.messages.includes('SKIP_WAITING'),false);
});
test('manual check reports offline failure; foreground and online retry automatically',async()=>{
 const f=fixture({candidate:'0.2.0'});await settle();await f.updater.check(true);assert.match(f.elements['update-status'].textContent,/última versión/);
 f.env.fetch=async()=>{throw Error('Offline');};await f.updater.check(true);assert.match(f.elements['update-status'].textContent,/conexión/);assert.equal(f.elements.update.disabled,false);
 let count=0;f.env.fetch=async()=>{count++;return {ok:true,json:async()=>({version:'0.2.0',build:'abc'})};};f.listeners.online();await settle();f.listeners.visibilitychange();await settle();assert.equal(count,2);
});
