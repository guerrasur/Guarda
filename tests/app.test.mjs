import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { indexedDB } from 'fake-indexeddb';
import { GuardaStore } from '../src/storage.js';

const pause=ms=>new Promise(r=>nativeTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await pause(10);}throw new Error('Timed out waiting for application state');}
const nativeInterval=globalThis.setInterval;
const nativeTimeout=globalThis.setTimeout;
const channels=[];
class Channel{constructor(){channels.push(this);}postMessage(){}close(){}}
const {document,window}=parseHTML(await readFile(new URL('../index.html',import.meta.url),'utf8'));
Object.assign(globalThis,{document,window,indexedDB,BroadcastChannel:Channel,innerWidth:1365,innerHeight:900,location:{hash:''},matchMedia:()=>({matches:false,addEventListener(){}})});
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Test Safari',storage:{persist:async()=>true}},configurable:true});
globalThis.setInterval=(...args)=>{const t=nativeInterval(...args);t.unref();return t;};
globalThis.setTimeout=(...args)=>{const t=nativeTimeout(...args);t.unref();return t;};
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event{constructor(t,o={}){super(t);this.detail=o.detail;}};
for(const e of document.querySelectorAll('*')){e.getBoundingClientRect=()=>({left:100,top:100,bottom:140,width:400,height:200});}
for(const d of document.querySelectorAll('dialog')){d.showModal=()=>{d.open=true;};d.close=()=>{d.open=false;};}
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(value){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.getAttribute('value')===value);},configurable:true});
Object.defineProperty(window.HTMLInputElement.prototype,'checked',{get(){return this.hasAttribute('checked');},set(value){this.toggleAttribute('checked',!!value);},configurable:true});
const $=id=>document.getElementById(id);
const app=await import('../src/app.js');
const store=new GuardaStore({broadcast:false});
const input=(element,value)=>{element.value=value;element.dispatchEvent(new window.Event('input',{bubbles:true}));};
async function create(title,body='Texto'){await $('new-note').onclick();input($('note-title'),title);$('editor-body').innerHTML=body;$('editor-body').dispatchEvent(new window.Event('input',{bubbles:true}));await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);}

await test('UI saves, reopens, searches and preserves notes across database connections',async()=>{
 await until(()=>$('navigation').children.length>0);await create('Primera idea','Un texto <b>con formato</b>');
 let saved=await store.allNotes();assert.equal(saved.length,1);assert.equal(saved[0].title,'Primera idea');assert.match(saved[0].body,/con formato/);
 const card=document.querySelector('[data-note]');card.dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);assert.equal($('note-title').value,'Primera idea');await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);
 input($('search'),'inexistente');await until(()=>!$('empty-state').hidden);assert.equal(document.querySelectorAll('[data-note]').length,0);$('clear-search').onclick();await until(()=>document.querySelectorAll('[data-note]').length===1);
 const reopened=new GuardaStore({broadcast:false});assert.equal((await reopened.allNotes())[0].title,'Primera idea');reopened.close();
});
await test('a single character edit moves an older note first by default; settings can disable it',async()=>{
 await pause(15);await create('Segunda idea');let saved=await store.allNotes();const first=saved.find(n=>n.title==='Primera idea'),second=saved.find(n=>n.title==='Segunda idea');assert.ok(second.order>first.order);
 document.querySelector(`[data-note="${first.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);await pause(15);input($('note-title'),'Primera ideax');await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);saved=await store.allNotes();const updated=saved.find(n=>n.id===first.id);assert.ok(updated.order>second.order);assert.equal(document.querySelector('[data-note]').dataset.note,first.id);
 const before=updated.order;document.querySelector(`[data-note="${first.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);await pause(15);await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);assert.equal((await store.allNotes()).find(n=>n.id===first.id).order,before,'opening without editing must not reorder');
 $('settings-toggle').onclick();const checkbox=$('updated-first-setting');assert.equal(checkbox.checked,true);checkbox.checked=false;await checkbox.onchange({target:checkbox});$('utility-dialog').close();
 document.querySelector(`[data-note="${second.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);input($('note-title'),'Segunda ide');await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);assert.equal((await store.allNotes()).find(n=>n.id===second.id).order,second.order);assert.equal(await store.getSetting('updatedFirst',true),false);
});
await test('checklists persist checked items; archive and restore preserve note text',async()=>{
 await $('new-list').onclick();input($('note-title'),'Lista');const field=$('editor-checklist').querySelector('input[type=text]');input(field,'Comprar pan');const box=$('editor-checklist').querySelector('input[type=checkbox]');box.checked=true;box.dispatchEvent(new window.Event('change',{bubbles:true}));await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);const n=(await store.allNotes()).find(n=>n.title==='Lista');assert.equal(n.items[0].text,'Comprar pan');assert.equal(n.items[0].checked,true);
 const card=document.querySelector(`[data-note="${n.id}"]`);card.querySelector('[data-action=archive]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(async()=>(await store.allNotes()).find(x=>x.id===n.id).archived===true);document.querySelector('[data-route=archive]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>document.querySelector(`[data-note="${n.id}"]`));assert.match($('notes-area').textContent,/Lista/);
 document.querySelector(`[data-note="${n.id}"] [data-action=archive]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(async()=>(await store.allNotes()).find(x=>x.id===n.id).archived===false);
});
await test('rich note sanitizer strips active content and all unsafe attributes',()=>{
 const html=app.sanitizeRich('<b onclick="alert(1)">Hola</b><img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">enlace</a><svg onload="alert(1)"></svg>');assert.equal(html,'<b>Hola</b>enlace');
});
store.close();
await test('recording is saved as an audio attachment, with note text retained and playable after reopening',async()=>{
 navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};
 globalThis.MediaRecorder=class {static isTypeSupported(type){return type==='audio/mp4';}constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';}start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['real audio bytes'],{type:'audio/mp4'})});this.onstop?.();});}};
 document.querySelector('[data-route=notes]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('composer').hidden);await $('new-audio').onclick();assert.equal($('record-panel').hidden,false);input($('note-title'),'Idea hablada');$('editor-body').innerHTML='Texto junto al audio';$('editor-body').dispatchEvent(new window.Event('input',{bubbles:true}));await $('record-stop').onclick();assert.equal($('record-panel').hidden,true);assert.equal($('editor-audios').querySelectorAll('audio').length,1);await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);
 const n=(await store.allNotes()).find(n=>n.title==='Idea hablada');assert.match(n.body,/Texto junto/);assert.equal(n.attachments.length,1);const audio=await store.getAttachment(n.attachments[0]);assert.equal(audio.type,'audio/mp4');assert.equal(await audio.blob.text(),'real audio bytes');assert.equal(audio.draft,undefined);
 document.querySelector(`[data-note="${n.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!!$('editor-audios').querySelector('audio'));assert.match($('editor-audios').querySelector('audio').getAttribute('src'),/^blob:/);await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);
 const backup=await store.exportBackup();assert.ok(backup.attachments.some(a=>a.id===audio.id&&a.data));
});
await test('closing while audio is being committed waits for the complete audio instead of orphaning it',async()=>{
 await $('new-audio').onclick();input($('note-title'),'Cierre durante guardado');
 const original=GuardaStore.prototype.attachToNote;let release,entered=false;
 const gate=new Promise(resolve=>release=resolve);
 GuardaStore.prototype.attachToNote=async function(note,attachment,options){if(!attachment.draft){entered=true;await gate;}return original.call(this,note,attachment,options);};
 try{const stop=$('record-stop').onclick();await until(()=>entered);const closing=$('editor-close').onclick();await pause(20);assert.equal($('editor-layer').hidden,false,'must retain editor until commit completes');release();await stop;await closing;await until(()=>$('editor-layer').hidden);const n=(await store.allNotes()).find(n=>n.title==='Cierre durante guardado');assert.equal(n.attachments.length,1);const a=await store.getAttachment(n.attachments[0]);assert.equal(a.draft,undefined);assert.equal(await a.blob.text(),'real audio bytes');}finally{GuardaStore.prototype.attachToNote=original;release();}
});
await test('restoring a backup with interrupted recording fragments recovers visible audio immediately',async()=>{
 const other=new GuardaStore({name:'backup-with-fragments',broadcast:false});const n={id:'restored-note',title:'Audio interrumpido',body:'Texto',items:[],labels:[],attachments:['fragment-1'],createdAt:Date.now(),order:Date.now()};await other.putNote(n);await other.putAttachment({id:'fragment-1',noteId:n.id,blob:new Blob(['recover me'],{type:'audio/mp4'}),type:'audio/mp4',name:'Fragmento',draft:true,recordingId:'interrupted-recording',index:0,duration:2,createdAt:Date.now()});const backup=await other.exportBackup();other.close();
 $('backup-file').onchange({target:{files:[{text:async()=>JSON.stringify(backup)}],value:''}});await until(()=>$('utility-dialog').open&&$('utility-content').textContent.includes('Restaurar esta copia'));
 const restore=[...$('utility-content').querySelectorAll('[data-dialog-action]')].find(e=>e.textContent==='Restaurar');await $('utility-content').onclick({target:restore});await until(()=>document.querySelector(`[data-note="${n.id}"] audio`));const restored=(await store.allNotes()).find(x=>x.id===n.id);assert.equal(restored.attachments.length,1);assert.notEqual(restored.attachments[0],'fragment-1');const a=await store.getAttachment(restored.attachments[0]);assert.equal(await a.blob.text(),'recover me');assert.equal(a.draft,undefined);
});
await test('board drag saves before/after order without changing content timestamps or update-first preference',async()=>{
 await create('Destino');await create('Arrastrada');const before=await store.allNotes(),a=before.find(n=>n.title==='Arrastrada'),b=before.find(n=>n.title==='Destino');
 const source=document.querySelector(`[data-note="${a.id}"]`),destination=document.querySelector(`[data-note="${b.id}"]`);
 document.elementFromPoint=()=>destination;
 function drag(target,type,y=290){const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{clientX:150,clientY:y,dataTransfer:{setData(){}}});target.dispatchEvent(event);}
 drag(source,'dragstart');drag(destination,'dragover');drag(destination,'drop');
 await until(async()=>{const notes=await store.allNotes();return notes.find(n=>n.id===a.id).order<notes.find(n=>n.id===b.id).order;});
 const after=await store.allNotes();assert.equal(after.find(n=>n.id===a.id).updatedAt,a.updatedAt);assert.equal(after.find(n=>n.id===b.id).body,b.body);assert.equal(await store.getSetting('updatedFirst',false),false);
});
await test('two concurrent close requests save once and close cleanly without a false storage error',async()=>{
 await $('new-note').onclick();input($('note-title'),'Cerrar dos veces');
 const original=GuardaStore.prototype.putNote;let release,entered=false;const gate=new Promise(resolve=>release=resolve);let writes=0;
 GuardaStore.prototype.putNote=async function(note){if(note.title==='Cerrar dos veces'){entered=true;writes++;await gate;}return original.call(this,note);};
 try{const first=$('editor-close').onclick();await until(()=>entered);const second=$('editor-back').onclick();release();assert.equal(await first,true);assert.equal(await second,true);assert.equal(writes,1);assert.equal($('editor-layer').hidden,true);assert.equal((await store.allNotes()).filter(n=>n.title==='Cerrar dos veces').length,1);}finally{release();GuardaStore.prototype.putNote=original;}
});
await test('an undo failure leaves its error message visible instead of hiding the replacement toast',async()=>{
 const card=document.querySelector('[data-note]');const id=card.dataset.note;
 card.querySelector('[data-action=archive]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>$('toast').textContent.includes('Nota archivada'));
 const original=GuardaStore.prototype.putNote,log=console.error;GuardaStore.prototype.putNote=async()=>{throw new Error('Fallo de guardado de prueba');};console.error=()=>{};
 try{await $('toast').querySelector('button').onclick();assert.equal($('toast').hidden,false);assert.match($('toast').textContent,/Fallo de guardado de prueba/);assert.equal((await store.allNotes()).find(n=>n.id===id).archived,true);}finally{GuardaStore.prototype.putNote=original;console.error=log;}
});
await test('Drive is preconfigured for GuardaNote and enables connection without requesting access automatically',async()=>{
 const {GOOGLE_CLIENT_ID}=await import('../src/drive-config.js');let requested=0,configured;
 globalThis.google={accounts:{oauth2:{initTokenClient:options=>{configured=options;return {requestAccessToken:()=>requested++};}}}};
 try{const count=(await store.allNotes()).length;$('settings-toggle').onclick();$('drive-settings').onclick();await until(()=>$('drive-panel-status')&&$('drive-connect').disabled===false);assert.equal($('drive-client-id').value,GOOGLE_CLIENT_ID);assert.equal(configured.client_id,GOOGLE_CLIENT_ID);assert.equal(requested,0);assert.equal((await store.allNotes()).length,count);$('utility-dialog').close();}finally{delete globalThis.google;}
});
await test('Keep import guide previews a local Takeout ZIP before adding notes and skips a repeated import',async()=>{
 const {zipSync,strToU8}=await import('../src/vendor/fflate.js');const source={title:'Importada desde Keep',textContent:'Texto importado <script>literal</script>',createdTimestampUsec:1700000000000000,userEditedTimestampUsec:1700000001000000,isPinned:false,isArchived:false,color:'DEFAULT',labels:[]};
 const bytes=zipSync({'Takeout/Keep/Nota.json':strToU8(JSON.stringify(source))}),file={name:'takeout.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer};const count=(await store.allNotes()).length;
 async function choose(){const alive=nativeInterval(()=>{},1000);try{$('settings-toggle').onclick();$('import-keep').onclick();assert.match($('utility-content').textContent,/Google Takeout/);const input=$('keep-files');Object.defineProperty(input,'files',{value:[file],configurable:true});await input.onchange();}finally{clearInterval(alive);}}
 await choose();assert.match($('keep-import-status').textContent,/1 notas para importar/);assert.equal((await store.allNotes()).length,count,'preview must not modify local notes');assert.equal($('keep-confirm').disabled,false);await $('keep-confirm').onclick();assert.equal((await store.allNotes()).length,count+1);assert.equal((await store.allNotes()).find(n=>n.title===source.title).body,source.textContent);assert.equal($('utility-dialog').open,false);
 await choose();assert.match($('keep-import-status').textContent,/0 notas para importar.*1 notas idénticas/);assert.equal($('keep-confirm').disabled,true);$('utility-dialog').close();
});
await test('opening text notes and checklists focuses the dialog instead of an editable field',async()=>{
 const original=window.HTMLElement.prototype.focus;const focused=[];
 window.HTMLElement.prototype.focus=function(){focused.push(this);};
 try{
  for(const isList of [false,true]){
   if(isList){await $('new-list').onclick();input($('note-title'),'Keyboard list');await $('editor-close').onclick();}else await create('Keyboard text');
   const note=(await store.allNotes()).find(n=>n.title===(isList?'Keyboard list':'Keyboard text'));assert.ok(note);
   document.querySelector(`[data-route="notes"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>document.querySelector(`[data-note="${note.id}"]`));
   focused.length=0;document.querySelector(`[data-note="${note.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>focused.includes($('editor')));
   assert.equal(focused.some(e=>e.matches('input,textarea,[contenteditable=true]')),false);assert.equal($('editor-body').getAttribute('contenteditable'),'true');await $('editor-close').onclick();
  }
 }finally{window.HTMLElement.prototype.focus=original;}
});
await test('app information is available at the bottom of the menu with author, contact and live version',()=>{
 $('app-info').onclick();assert.equal($('utility-dialog').open,true);assert.match($('utility-content').textContent,/Lucio Guerra/);assert.match($('utility-content').textContent,/en desarrollo/);assert.equal($('utility-content').querySelector('a').getAttribute('href'),'mailto:lucioguerrasur@gmail.com');assert.equal($('sidebar').querySelector('.sidebar-bottom').lastElementChild.id,'app-info');$('utility-dialog').close();
});
