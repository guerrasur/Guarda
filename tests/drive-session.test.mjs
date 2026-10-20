import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DriveSessionBridge } from '../src/drive-session.js';
const source=await readFile('sw.js','utf8');
function fixture(){
 let now=Date.now();const values=new Map();
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 function worker(url='https://example.test/Guarda/?v=0.6.12'){
  const listeners={};vm.runInNewContext(source,{URL,Date:class extends Date{static now(){return now;}},self:{registration:{scope:'https://example.test/Guarda/'},addEventListener:(name,fn)=>listeners[name]=fn}});
  return {postMessage(data,ports){listeners.message({data,ports,source:{url,type:'window'}});}};
 }
 function bridge(controller=worker(),sessionStorage=storage){return new DriveSessionBridge({env:{crypto,sessionStorage,MessageChannel,setTimeout,clearTimeout,navigator:{serviceWorker:{controller}}}});}
 return {worker,bridge,values,storage,advance:ms=>now+=ms,advanceTo:time=>now=time};
}
const session=()=>({clientId:'google-client',token:'sensitive-access-token',expires:Date.now()+3500000,user:{permissionId:'owner',emailAddress:'owner@example.test'}});
test('a new page consumes the update handoff once without storing any credentials',async()=>{
 const f=fixture(),worker=f.worker(),before=f.bridge(worker);assert.equal(await before.offer(session()),true);
 const after=f.bridge(worker);assert.equal((await after.take()).token,session().token);assert.equal(await after.take(),null);
 assert.equal(f.values.size,1);assert.doesNotMatch(JSON.stringify([...f.values]),/access-token|owner|google-client/);
});
test('handoffs survive a minute and expire at the token deadline',async()=>{
 const f=fixture(),worker=f.worker(),snapshot=session();assert.equal(await f.bridge(worker).offer(snapshot),true);
 f.advance(61000);assert.equal((await f.bridge(worker).take()).token,snapshot.token);
 assert.equal(await f.bridge(worker).offer(snapshot),true);f.advanceTo(snapshot.expires);assert.equal(await f.bridge(worker).take(),null);
});
test('terminating the worker discards a successfully stored, unexpired session',async()=>{
 const f=fixture(),worker=f.worker();assert.equal(await f.bridge(worker).offer(session()),true);
 assert.equal(await f.bridge(f.worker()).take(),null);
 assert.equal((await f.bridge(worker).take()).token,session().token);
});
test('other tabs and pages outside Guarda cannot read or replace the handoff',async()=>{
 const f=fixture(),worker=f.worker();await f.bridge(worker).offer(session());
 const otherStorage={getItem(){},setItem(){}};assert.equal(await f.bridge(worker,otherStorage).take(),null);
 for(const url of ['https://attacker.example/Guarda/','https://example.test/AnotherApp/','https://example.test/Guarda/privacidad.html'])assert.equal(await f.bridge(f.worker(url)).offer(session()),false);
 assert.equal((await f.bridge(worker).take()).user.permissionId,'owner');
});
test('explicit disconnect clears the handoff and unsupported workers do not block updates',async()=>{
 const f=fixture(),worker=f.worker(),bridge=f.bridge(worker);await bridge.offer(session());await bridge.clear();assert.equal(await bridge.take(),null);
 assert.equal(await f.bridge(null).offer(session()),false);
 assert.equal(await f.bridge({postMessage(){throw Error('Worker stopped');}}).offer(session()),false);
});
test('expired and malformed credentials are never offered',async()=>{
 const f=fixture(),bridge=f.bridge();
 for(const value of [{...session(),expires:Date.now()-1},{...session(),token:''},{...session(),user:{}}])assert.equal(await bridge.offer(value),false);
 assert.equal(await bridge.take(),null);
});
