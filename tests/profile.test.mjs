import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {initProfile,driveDescription} from '../src/profile.js';
test('profile choices persist, survive reopening and never show the disconnected warning for connected Drive',async()=>{
 const {document}=parseHTML('<html><button id="local-info"><img id="profile-image"></button><div id="panel"></div></html>');const values=new Map();let info={connected:true,enabled:true,state:'synced'},change,opened=0;
 const store={getSetting:async(k,f)=>values.get(k)??f,setSetting:async(k,v)=>{values.set(k,v);change({detail:{type:'setting',id:k}});},addEventListener:(_,fn)=>change=fn};
 const profile=initProfile({store,drive:{getState:()=>info,open:async()=>opened++},env:{document},utility:(_,html)=>document.getElementById('panel').innerHTML=html,closeUtility(){},showError:e=>{throw e;}});
 await profile.open();assert.equal(document.querySelectorAll('[data-avatar]').length,3);assert.match(document.getElementById('panel').textContent,/Todo guardado en Google Drive/);assert.doesNotMatch(document.getElementById('panel').textContent,/Sin conectar|Conectar Google Drive/);
 await document.querySelector('[data-avatar=fern]').onclick();assert.equal(values.get('profile-avatar'),'fern');assert.equal(document.getElementById('profile-image').getAttribute('src'),'./avatars/fern.png');
 await profile.open();assert.equal(document.querySelector('[data-avatar=fern]').getAttribute('aria-pressed'),'true');document.getElementById('profile-drive').onclick();assert.equal(opened,1);
 info={connected:false,enabled:true};await profile.open();assert.match(document.getElementById('panel').textContent,/Reconectar Google Drive/);assert.doesNotMatch(document.getElementById('panel').textContent,/Todo guardado/);
 values.set('profile-avatar','untrusted/path');await profile.render();assert.equal(document.getElementById('profile-image').getAttribute('src'),'./avatars/clover.png');
});
test('storage explanation distinguishes disconnected, pending, failed and fully saved Drive',()=>{
 assert.match(driveDescription(),/Podés conectar/);assert.match(driveDescription({enabled:true}),/Reconectala/);assert.match(driveDescription({connected:true,state:'pending'}),/cambios por sincronizar/);assert.match(driveDescription({connected:true,state:'error'}),/No se pudo completar/);assert.match(driveDescription({connected:true,state:'synced'}),/Todo guardado/);
});

test('legacy cached header is repaired before reading the selected avatar',async()=>{
 const {document}=parseHTML('<html><body><div><button id="drive-indicator" class="drive-indicator">!</button><button id="local-info"><img src="./guardia-icon.png"></button></div><div id="panel"></div></body></html>');
 const ui=initProfile({store:{getSetting:async()=> 'fern',addEventListener(){}},drive:{getState:()=>({connected:true,state:'synced'})},env:{document},utility:(_,html)=>document.getElementById('panel').innerHTML=html,closeUtility(){},showError:e=>{throw e;}});
 await ui.open();assert.equal(document.getElementById('profile-image').getAttribute('src'),'./avatars/fern.png');assert.equal(document.getElementById('drive-indicator').parentNode.id,'local-info');assert.equal(document.getElementById('drive-indicator').className,'profile-ring');assert.equal(document.getElementById('drive-indicator').textContent,'');assert.equal(document.querySelectorAll('#drive-indicator').length,1);
});
test('profile offers direct sync or reconnect and updates its status without closing the plant picker',async()=>{
 const {document}=parseHTML('<html><button id="local-info"><img id="profile-image"></button><div id="panel"></div></html>');let info={connected:true,state:'synced'},listener,syncs=0,connects=0;
 const profile=initProfile({store:{getSetting:async()=> 'clover',addEventListener(){}},drive:{getState:()=>info,subscribe:fn=>listener=fn,sync:async()=>syncs++,connect:async()=>connects++},env:{document},utility:(_,html)=>document.getElementById('panel').innerHTML=html,closeUtility(){},showError:e=>{throw e;}});
 await profile.open();assert.equal(document.getElementById('profile-sync').textContent,'Sincronizar ahora');document.getElementById('profile-sync').onclick();assert.equal(syncs,1);
 info={connected:true,state:'offline'};listener();assert.match(document.getElementById('profile-sync-status').textContent,/Sin conexión a internet/);assert.equal(document.querySelectorAll('[data-avatar]').length,3);
 info={connected:false,enabled:true,state:'reconnect'};listener();assert.match(document.getElementById('profile-sync').textContent,/Reconectar/);document.getElementById('profile-sync').onclick();assert.equal(connects,1);
});
