import test from 'node:test';import assert from 'node:assert/strict';import { readFile,access } from 'node:fs/promises';import vm from 'node:vm';
await test('manifest and offline shell point only to files shipped with the app',async()=>{
 const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8'));assert.equal(manifest.name,'Guarda');assert.equal(manifest.display,'standalone');for(const icon of manifest.icons)await access(`public/${icon.src.replace('./','')}`);
 const html=await readFile('index.html','utf8');assert.match(html,/apple-mobile-web-app-capable/);assert.match(html,/apple-touch-icon/);assert.doesNotMatch(html,/https?:\/\//);
 const listeners={},cache=new Map(),oldCaches=['guarda-shell-old','another-app-cache'];const deleted=[];const origin='https://example.test';let offline=false;
 const context={URL,Promise,console,fetch:async request=>{if(offline)throw new Error('offline');return {url:request.url||request,ok:true};},self:{location:{origin},registration:{scope:origin+'/'},clients:{claim:async()=>{}},addEventListener:(n,f)=>listeners[n]=f},caches:{open:async()=>({addAll:async files=>{for(const f of files){const absolute=new URL(f,origin+'/').href;cache.set(absolute,{cached:absolute});const name=f.replace('./','');if(!name)await access('index.html');else await access(['guardia-icon.png','favicon.ico','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png','icon-192.png','icon-512.png','avatars/clover.png','avatars/fern.png','avatars/thistle.png'].includes(name)?'public/'+name:name);}}}),match:async request=>cache.get(typeof request==='string'?request:request.href||request.url),keys:async()=>oldCaches,delete:async key=>deleted.push(key)}};
 vm.runInNewContext(await readFile('sw.js','utf8'),context);let pending;listeners.install({waitUntil:p=>pending=p});await pending;listeners.activate({waitUntil:p=>pending=p});await pending;assert.deepEqual(deleted,['guarda-shell-old']);offline=true;
 let response;listeners.fetch({request:{url:origin+'/',method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.equal((await response).cached,origin+'/index.html');
 response=undefined;listeners.fetch({request:{url:origin+'/privacidad.html',method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.equal(response,undefined,'privacy page must not be replaced by the app shell');
 response=undefined;listeners.fetch({request:{url:'blob:audio',method:'GET'},respondWith:p=>response=p});assert.equal(response,undefined,'local audio is not fetched or uploaded');
});
await test('worker only skips waiting on request and reports its staged release',async()=>{
 const listeners={};let skips=0,info;
 vm.runInNewContext(await readFile('sw.js','utf8'),{self:{addEventListener:(name,f)=>listeners[name]=f,skipWaiting:()=>skips++}});
 assert.equal(skips,0);listeners.message({data:{type:'RELEASE_INFO'},ports:[{postMessage:value=>info=value}]});assert.equal(info.version,'GUARDA_APP_VERSION');assert.equal(info.build,'GUARDA_BUILD_VERSION');assert.equal(skips,0);
 listeners.message({data:{type:'SKIP_WAITING'}});assert.equal(skips,1);
});
