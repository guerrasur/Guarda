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
const recoveryMemory=new Map();globalThis.localStorage={get length(){return recoveryMemory.size;},key:i=>[...recoveryMemory.keys()][i],getItem:k=>recoveryMemory.get(k)??null,setItem:(k,v)=>recoveryMemory.set(k,v),removeItem:k=>recoveryMemory.delete(k)};
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
 const restore=[...$('utility-content').querySelectorAll('[data-dialog-action]')].find(e=>e.textContent==='Restaurar');await $('utility-content').onclick({target:restore});await until(()=>document.querySelector(`[data-note="${n.id}"] .audio-preview`));const restored=(await store.allNotes()).find(x=>x.id===n.id);assert.equal(restored.attachments.length,1);assert.notEqual(restored.attachments[0],'fragment-1');const a=await store.getAttachment(restored.attachments[0]);assert.equal(await a.blob.text(),'recover me');assert.equal(a.draft,undefined);
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
await test('Drive preallocates a one-use launch ticket without opening Google or changing notes',async()=>{
 const {GOOGLE_CLIENT_ID,DRIVE_BROKER_URL}=await import('../src/drive-config.js');let requested=0,configured=false;
 const originalFetch=globalThis.fetch;
 globalThis.google={accounts:{oauth2:{initTokenClient:()=>{requested++;throw Error('Persistent Drive must not initialize browser OAuth');}}}};
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.credentials,'omit');
  if(url===DRIVE_BROKER_URL+'/v1/config'){
   configured=true;return Response.json({persistent:true,clientId:GOOGLE_CLIENT_ID});
  }
  if(url===DRIVE_BROKER_URL+'/v1/authorizations'&&options.method==='POST'){
   const input=JSON.parse(options.body);assert.match(input.challenge,/^[\w-]{43}$/);
   return Response.json({id:'a'.repeat(43),launchTicket:'b'.repeat(43)});
  }
  throw Error('Unexpected Drive broker endpoint '+url);
 };
 try{const count=(await store.allNotes()).length;$('settings-toggle').onclick();$('drive-settings').onclick();await until(()=>configured&&$('drive-panel-status')&&$('drive-connect').disabled===false);assert.equal($('drive-client-id').value,GOOGLE_CLIENT_ID);assert.equal(requested,0);assert.equal($('drive-connect').textContent,'Conectar Google Drive');assert.equal((await store.allNotes()).length,count);$('utility-dialog').close();}finally{globalThis.fetch=originalFetch;delete globalThis.google;}
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
await test('paperclip offers Photos and Files, persists multiple original files, reopens them and removes one safely',async()=>{
 await create('Archivos de prueba');const n=(await store.allNotes()).find(n=>n.title==='Archivos de prueba');document.querySelector(`[data-note="${n.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);
 $('editor-image').onclick({currentTarget:$('editor-image')});assert.match($('popover').textContent,/Fototeca/);assert.match($('popover').textContent,/Archivos/);assert.match($('popover').textContent,/20 MB/);assert.equal($('attachment-file').hasAttribute('accept'),false);assert.equal($('image-file').getAttribute('accept'),'image/*');
 let chosen=false;const originalClick=$('attachment-file').click;$('attachment-file').click=()=>chosen=true;$('attach-files').onclick();assert.equal(chosen,true);$('attachment-file').click=originalClick;
 const pdf=Object.assign(new Blob(['%PDF-original'],{type:'application/pdf'}),{name:'Escena.pdf'}),zip=Object.assign(new Blob([new Uint8Array([0,255,1,128])],{type:'application/zip'}),{name:'material.zip'});
 Object.defineProperty($('attachment-file'),'files',{value:[pdf,zip],configurable:true});await $('attachment-file').onchange({target:$('attachment-file')});
 const saved=(await store.allNotes()).find(x=>x.id===n.id);assert.equal(saved.attachments.length,2);const files=await Promise.all(saved.attachments.map(id=>store.getAttachment(id)));assert.equal(await files[0].blob.text(),'%PDF-original');assert.equal(files[0].name,'Escena.pdf');assert.deepEqual(new Uint8Array(await files[1].blob.arrayBuffer()),new Uint8Array([0,255,1,128]));assert.equal($('editor-files').querySelectorAll('[data-attachment]').length,2);assert.equal($('attachment-file').value,'');
 await $('editor-close').onclick();assert.match(document.querySelector(`[data-note="${n.id}"]`).textContent,/Escena.pdf/);document.querySelector(`[data-note="${n.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>$('editor-files').querySelectorAll('[data-attachment]').length===2);
 $('editor-files').querySelector('[data-action=delete-attachment]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(async()=>(await store.allNotes()).find(x=>x.id===n.id).attachments.length===1);assert.equal(await store.getAttachment(files[0].id),undefined);assert.ok(await store.getAttachment(files[1].id));await $('editor-close').onclick();
});
await test('oversized file selections save nothing and show a clear size limit',async()=>{
 await $('new-note').onclick();input($('note-title'),'Límite de archivos');const good=Object.assign(new Blob(['ok']),{name:'ok.txt'}),bad={name:'grande.zip',type:'application/zip',size:21*1024*1024};
 Object.defineProperty($('attachment-file'),'files',{value:[good,bad],configurable:true});await $('attachment-file').onchange({target:$('attachment-file')});assert.match($('toast').textContent,/20 MB/);assert.equal($('editor-files').querySelectorAll('[data-attachment]').length,0);await $('editor-close').onclick();assert.equal((await store.allNotes()).find(x=>x.title==='Límite de archivos').attachments.length,0);
});
await test('closing a note waits for file storage and downloaded attachments keep their original filename',async()=>{
 await $('new-note').onclick();input($('note-title'),'Adjunto en proceso');
 const originalAttach=GuardaStore.prototype.attachToNote;let release,entered=false;GuardaStore.prototype.attachToNote=async function(...args){entered=true;await new Promise(resolve=>release=resolve);return originalAttach.apply(this,args);};
 const file=Object.assign(new Blob(['audio original'],{type:'audio/mpeg'}),{name:'tema.mp3'});Object.defineProperty($('attachment-file'),'files',{value:[file],configurable:true});
 try{
  const pending=$('attachment-file').onchange({target:$('attachment-file')});await until(()=>entered);const closing=$('editor-close').onclick();await pause(10);assert.equal($('editor-layer').hidden,false);release();await pending;await closing;assert.equal($('editor-layer').hidden,true);
 }finally{GuardaStore.prototype.attachToNote=originalAttach;}
 const n=(await store.allNotes()).find(n=>n.title==='Adjunto en proceso');assert.equal(n.attachments.length,1);const stored=await store.getAttachment(n.attachments[0]);assert.equal(stored.name,'tema.mp3');assert.equal(await stored.blob.text(),'audio original');
 const originalClick=window.HTMLAnchorElement.prototype.click;let filename;window.HTMLAnchorElement.prototype.click=function(){filename=this.download;};
 try{document.querySelector(`[data-note="${n.id}"] [data-action=download-audio]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>filename);assert.equal(filename,'tema.mp3');}finally{window.HTMLAnchorElement.prototype.click=originalClick;}
});
await test('opening and closing an unchanged saved note does not generate a write or a cloud upload trigger',async()=>{
 await create('Lectura sin cambios','Texto estable');const n=(await store.allNotes()).find(n=>n.title==='Lectura sin cambios');const revision=await store.getSetting('local-revision',0);
 document.querySelector(`[data-note="${n.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);await $('editor-close').onclick();assert.equal(await store.getSetting('local-revision',0),revision);assert.equal((await store.allNotes()).find(x=>x.id===n.id).body,'Texto estable');
});

await test('editor isolates the board and returns focus to the current card after rebuilding it',async()=>{
 await create('Regreso al tablero','Sin perder el foco');const n=(await store.allNotes()).find(n=>n.title==='Regreso al tablero');
 document.querySelector(`[data-note="${n.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);
 assert.equal($('main').inert,true);assert.equal(document.querySelector('.header').inert,true);
 const oldFocus=window.HTMLElement.prototype.focus;let focused;
 window.HTMLElement.prototype.focus=function(){focused=this;};
 try{await $('editor-close').onclick();assert.equal($('main').inert,false);assert.equal(document.querySelector('.header').inert,false);assert.equal(focused,document.querySelector(`[data-note="${n.id}"]`));assert.equal($('editor-layer').inert,false);}finally{window.HTMLElement.prototype.focus=oldFocus;}
});

await test('a failed close restores editor interaction and preserves the unsaved text for retry',async()=>{
 await $('new-note').onclick();input($('note-title'),'Reintentar cierre');
 const original=GuardaStore.prototype.putNote,log=console.error;console.error=()=>{};
 GuardaStore.prototype.putNote=async()=>{throw Error('No se pudo guardar');};
 try{assert.equal(await $('editor-close').onclick(),false);assert.equal($('editor-layer').hidden,false);assert.equal($('editor-layer').inert,false);assert.equal($('main').inert,true);assert.equal($('note-title').value,'Reintentar cierre');}finally{GuardaStore.prototype.putNote=original;console.error=log;}
 assert.equal(await $('editor-close').onclick(),true);assert.ok((await store.allNotes()).find(n=>n.title==='Reintentar cierre'));
});
await test('new audio notes save MP3 and full waveform metadata and defer waveform rendering until playback',async()=>{
 const {encodeMonoMp3}=await import('../src/mp3-worker.js');const oldContext=globalThis.AudioContext,oldWorker=globalThis.Worker,oldRecorder=globalThis.MediaRecorder;
 const samples=Float32Array.from({length:4410},(_,i)=>.5*Math.sin(i/10));const decoded={length:samples.length,sampleRate:44100,duration:.1,numberOfChannels:1,getChannelData:()=>samples};
 globalThis.AudioContext=class{resume(){return Promise.resolve();}decodeAudioData(){return Promise.resolve(decoded);}close(){return Promise.resolve();}};
 globalThis.Worker=class{postMessage({samples,sampleRate}){queueMicrotask(()=>this.onmessage({data:{blob:encodeMonoMp3(new Float32Array(samples),sampleRate)}}));}terminate(){}};
 navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};
 globalThis.MediaRecorder=class{static isTypeSupported(type){return type==='audio/mp4';}constructor(){this.mimeType='audio/mp4';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['native AAC bytes'],{type:'audio/mp4'})});this.onstop();});}};
 try{
  await $('new-note').onclick();input($('note-title'),'MP3 con onda');await $('editor-mic').onclick();await $('record-stop').onclick();const n=(await store.allNotes()).find(n=>n.title==='MP3 con onda');assert.ok(n);const audio=await store.getAttachment(n.attachments[0]);assert.equal(audio.type,'audio/mpeg');assert.equal(audio.blob.type,'audio/mpeg');assert.equal(audio.waveform.peaks.length,160);assert.equal($('editor-audios').querySelector('.wave-base'),null);assert.equal($('editor-audios').querySelector('audio').getAttribute('preload'),'none');assert.ok($('record-waveform').querySelector('path'));
  await $('editor-close').onclick();const preview=document.querySelector(`[data-note="${n.id}"]`);assert.equal(preview.querySelector('audio'),null);assert.equal(preview.querySelector('[data-waveform]'),null);assert.ok(preview.querySelector('.audio-preview'));preview.dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!!$('editor-audios').querySelector('audio'));assert.equal($('editor-audios').querySelector('.wave-progress'),null);$('editor-audios').querySelector('audio').dispatchEvent(new window.Event('play',{bubbles:true}));await until(()=>!!$('editor-audios').querySelector('.wave-progress'));assert.equal($('editor-audios').querySelector('[data-waveform]').dataset.ready,'true');await $('editor-close').onclick();
 }finally{if(oldContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=oldContext;if(oldWorker===undefined)delete globalThis.Worker;else globalThis.Worker=oldWorker;globalThis.MediaRecorder=oldRecorder;}
});

await test('rapid create taps open one editor and save only one note',async()=>{
 const count=(await store.allNotes()).length;await Promise.all([$('new-note').onclick(),$('new-note').onclick()]);input($('note-title'),'Un solo toque lógico');await $('editor-close').onclick();assert.equal((await store.allNotes()).length,count+1);assert.equal((await store.allNotes()).filter(n=>n.title==='Un solo toque lógico').length,1);
});
await test('pinning and recoloring a checklist preserve its active text field and typed value',async()=>{
 await $('new-list').onclick();input($('note-title'),'Lista sin saltos');const field=$('editor-checklist').querySelector('input[type=text]');input(field,'Mantener el cursor');
 await $('editor-pin').onclick();assert.equal($('editor-checklist').querySelector('input[type=text]'),field);assert.equal(field.value,'Mantener el cursor');
 $('editor-color').onclick({currentTarget:$('editor-color')});$('popover').querySelector('[data-color=mint]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>$('editor').style.getPropertyValue('--card-bg')==='#e2f6d3');assert.equal($('editor-checklist').querySelector('input[type=text]'),field);await $('editor-close').onclick();
});
await test('bulk actions can unpin and unarchive selected notes with matching labels',async()=>{
 await create('Selección reversible A');await create('Selección reversible B');const ids=(await store.allNotes()).filter(n=>n.title.startsWith('Selección reversible')).map(n=>n.id);
 const select=async()=>{for(const id of ids){document.querySelector(`[data-note="${id}"] [data-action=select]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>document.querySelector(`[data-note="${id}"]`).classList.contains('selected'));}};
 async function action(name){$('selection-bar').querySelector(`[data-action="${name}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>$('selection-bar').hidden);}
 await select();await action('bulk-pin');assert.ok((await store.allNotes()).filter(n=>ids.includes(n.id)).every(n=>n.pinned));
 await select();assert.equal($('selection-bar').querySelector('[data-action=bulk-pin]').getAttribute('aria-label'),'Desfijar seleccionadas');await action('bulk-pin');assert.ok((await store.allNotes()).filter(n=>ids.includes(n.id)).every(n=>!n.pinned));
 await select();await action('bulk-archive');document.querySelector('[data-route=archive]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>ids.every(id=>document.querySelector(`[data-note="${id}"]`)));
 await select();assert.equal($('selection-bar').querySelector('[data-action=bulk-archive]').getAttribute('aria-label'),'Desarchivar seleccionadas');await action('bulk-archive');assert.ok((await store.allNotes()).filter(n=>ids.includes(n.id)).every(n=>!n.archived));
});
await test('editing and moving one note preserves unrelated cards, navigation and search controls',async()=>{
 document.querySelector('[data-route=notes]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('composer').hidden);
 await create('Idea para cámara');await create('Otra nota estable');const list=await store.allNotes(),a=list.find(n=>n.title==='Idea para cámara'),b=list.find(n=>n.title==='Otra nota estable');
 const stable=document.querySelector(`[data-note="${b.id}"]`),navigation=$('navigation').firstElementChild,filter=$('search-filters').firstElementChild;
 document.querySelector(`[data-note="${a.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);input($('note-title'),'Cámara y sonido');await $('editor-close').onclick();
 assert.equal(document.querySelector(`[data-note="${b.id}"]`),stable);assert.equal($('navigation').firstElementChild,navigation);
 input($('search'),'camara');await until(()=>document.querySelectorAll('[data-note]').length===1);assert.equal(document.querySelector('[data-note]').dataset.note,a.id);input($('search'),'cámara');await until(()=>document.querySelectorAll('[data-note]').length===1);assert.equal($('search-filters').firstElementChild,filter);$('clear-search').onclick();await until(()=>document.querySelector(`[data-note="${b.id}"]`));
});
await test('remote attachment replacement invalidates cached previews including updates received while editing',async()=>{
 document.querySelector('[data-route=notes]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('composer').hidden);
 await create('Archivos entre pestañas');const n=(await store.allNotes()).find(n=>n.title==='Archivos entre pestañas');
 const attachment={id:'remote-preview',noteId:n.id,type:'application/pdf',name:'Original.pdf',blob:new Blob(['original'])};
 await store.attachToNote({...n,attachments:[attachment.id]},attachment);channels[0].onmessage({data:{type:'attachment',id:attachment.id,noteId:n.id}});
 await until(()=>document.querySelector(`[data-note="${n.id}"]`)?.textContent.includes('Original.pdf'));
 const card=document.querySelector(`[data-note="${n.id}"]`);card.dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>$('editor-files').textContent.includes('Original.pdf'));
 await store.putAttachment({...attachment,name:'Actualizado.pdf',blob:new Blob(['actualizado'])});channels[0].onmessage({data:{type:'attachment',id:attachment.id,noteId:n.id}});
 assert.match($('editor-files').textContent,/Original.pdf/,'the active editor is left stable until close');
 const originalRead=GuardaStore.prototype.getAttachment;let reads=0;GuardaStore.prototype.getAttachment=function(id){if(id===attachment.id)reads++;return originalRead.call(this,id);};
 try{await $('editor-pin').onclick();assert.equal(reads,0,'pinning must not invalidate active media before the editor closes');}finally{GuardaStore.prototype.getAttachment=originalRead;}
 await $('editor-close').onclick();assert.match(document.querySelector(`[data-note="${n.id}"]`).textContent,/Actualizado.pdf/);
});

await test('selection keeps the exact card and its child controls; clearing selection preserves them too',async()=>{
 await create('Selección sin saltos');const n=(await store.allNotes()).find(n=>n.title==='Selección sin saltos');
 const card=document.querySelector(`[data-note="${n.id}"]`),button=card.querySelector('[data-action=select]');
 button.dispatchEvent(new window.Event('click',{bubbles:true}));assert.equal(card.classList.contains('selected'),true);
 assert.equal(document.querySelector(`[data-note="${n.id}"]`),card);assert.equal(button.getAttribute('aria-checked'),'true');
 $('selection-bar').querySelector('[data-action=clear-selection]').dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.equal(card.classList.contains('selected'),false);assert.equal(card.querySelector('[data-action=select]'),button);assert.equal(button.getAttribute('aria-checked'),'false');
});
await test('closing begins its motion while storage is pending and restores the board scroll position',async()=>{
 const oldAnimate=$('editor').animate,oldScroll=globalThis.scrollTo,oldY=globalThis.scrollY;
 const original=GuardaStore.prototype.putNote;let release,entered=false,animated=false,restored;
 globalThis.scrollY=640;globalThis.scrollTo=options=>restored=options;
 await $('new-note').onclick();input($('note-title'),'Volver fluido');
 $('editor').animate=()=>{animated=true;return {finished:Promise.resolve(),cancel(){}};};
 GuardaStore.prototype.putNote=async function(n){entered=true;await new Promise(r=>release=r);return original.call(this,n);};
 try{const closing=$('editor-close').onclick();await until(()=>entered);assert.equal(animated,true);assert.equal($('editor-layer').hidden,false);release();await closing;assert.equal(restored.top,640);assert.equal(document.body.style.top,'');assert.equal(document.body.classList.contains('editor-open'),false);}
 finally{release?.();GuardaStore.prototype.putNote=original;$('editor').animate=oldAnimate;globalThis.scrollTo=oldScroll;globalThis.scrollY=oldY;}
});

await test('individual deletion of a selected note clears the selection bar',async()=>{
 await create('Eliminar seleccionada');const n=(await store.allNotes()).find(n=>n.title==='Eliminar seleccionada');
 const card=document.querySelector(`[data-note="${n.id}"]`);
 card.querySelector('[data-action=select]').dispatchEvent(new window.Event('click',{bubbles:true}));
 card.querySelector('[data-action=more]').dispatchEvent(new window.Event('click',{bubbles:true}));
 $('popover').querySelector('[data-menu=trash]').dispatchEvent(new window.Event('click',{bubbles:true}));
 await until(async()=>(await store.allNotes()).find(x=>x.id===n.id).deletedAt);
 await until(()=>$('selection-bar').hidden);assert.equal(document.body.classList.contains('selecting-notes'),false);
});

await test('paste explicitly persists paragraphs and formatting even if insertHTML fires no input event',async()=>{
 await $('new-note').onclick();const old=document.execCommand;
 const html='<p>Primer <b>verso</b><br>Otra línea</p><p><s>Estrofa tachada</s></p><script>bad()</script>';
 document.execCommand=(command,ui,value)=>{assert.equal(command,'insertHTML');$('editor-body').innerHTML=value;return true;};
 try{$('editor-body').onpaste({preventDefault(){},clipboardData:{getData:type=>type==='text/html'?html:'Primer verso\nOtra línea\n\nEstrofa tachada'}});await $('editor-close').onclick();const n=(await store.allNotes()).find(n=>n.body==='Primer verso\nOtra línea\n\nEstrofa tachada');assert.ok(n);assert.match(n.richBody,/<b>verso<\/b>/);assert.match(n.richBody,/<s>Estrofa tachada<\/s>/);assert.doesNotMatch(n.richBody,/script|bad/);}finally{document.execCommand=old;}
});
await test('plain clipboard text retains every empty line and treats markup as text',()=>{
 assert.equal(app.clipboardHTML({getData:type=>type==='text/plain'?'uno\r\n\r\n\r\n<dos>':''}),'uno<br><br><br>&lt;dos&gt;');
});
await test('pagehide captures editor contents even when the browser omitted input',async()=>{
 await $('new-note').onclick();$('note-title').value='Último cambio sin evento';$('editor-body').innerHTML='Uno<br><br>Tres';window.dispatchEvent(new window.Event('pagehide'));await until(async()=>(await store.allNotes()).some(n=>n.title==='Último cambio sin evento'&&n.body==='Uno\n\nTres'));await $('editor-close').onclick();
});

await test('each keystroke has a synchronous recovery copy before the debounce and confirmed saves clear it',async()=>{
 await $('new-note').onclick();input($('note-title'),'Respaldo inmediato');$('editor-body').innerHTML='Verso<br><br>Estrofa';$('editor-body').oninput();const key=[...recoveryMemory.keys()].find(k=>k.startsWith('guarda-draft-v1:'));assert.ok(key);assert.equal(JSON.parse(recoveryMemory.get(key)).body,'Verso\n\nEstrofa');await $('editor-close').onclick();assert.equal(recoveryMemory.has(key),false);assert.equal(recoveryMemory.has('guarda-active-editor'),false);
});
await test('labels can be created and toggled inside a note without dismissing the replacement popover',async()=>{
 await $('new-note').onclick();input($('note-title'),'Etiquetas internas');
 $('editor-more').onclick({currentTarget:$('editor-more')});
 $('popover').querySelector('[data-menu=label]').dispatchEvent(new window.Event('click',{bubbles:true}));
 await until(()=>!!$('label-search'));assert.equal($('popover').hidden,false);
 input($('label-search'),'Rodaje nuevo');await $('create-label-here').onclick();
 assert.equal($('popover').hidden,false);assert.match($('editor-labels').textContent,/Rodaje nuevo/);
 const choice=$('popover').querySelector('[data-label-choice]');choice.checked=false;await $('popover').onchange({target:choice});
 assert.doesNotMatch($('editor-labels').textContent,/Rodaje nuevo/);
 await $('editor-close').onclick();
});

await test('sort controls persist direction and opening never edits a note',async()=>{
 document.querySelector('[data-route=notes]').dispatchEvent(new window.Event('click',{bubbles:true}));
 await create('Orden A');await pause(15);await create('Orden B');
 const all=await store.allNotes(),a=all.find(n=>n.title==='Orden A'),b=all.find(n=>n.title==='Orden B');
 $('note-sort').onclick();await $('popover').onclick({target:document.querySelector('[data-sort-option=created]')});
 const ids=()=>[...document.querySelectorAll('[data-note]')].map(n=>n.dataset.note);
 assert.ok(ids().indexOf(b.id)<ids().indexOf(a.id));
 await $('note-sort-direction').onclick();assert.ok(ids().indexOf(a.id)<ids().indexOf(b.id));
 assert.equal(await store.getSetting('noteSort'),'created');assert.equal(await store.getSetting('noteSortDirection'),'asc');
 document.querySelector(`[data-note="${a.id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);
 await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);
 assert.equal((await store.allNotes()).find(n=>n.id===a.id).updatedAt,a.updatedAt);
 assert.ok(JSON.parse(localStorage.getItem('guarda-note-opened-at'))[a.id]);
 $('note-sort').onclick();await $('popover').onclick({target:document.querySelector('[data-sort-option=opened]')});
 assert.ok(ids().indexOf(a.id)<ids().indexOf(b.id));
});

await test('sort direction responds immediately while preference storage is slow',async()=>{
 const original=GuardaStore.prototype.setSetting;let release;
 const gate=new Promise(resolve=>release=resolve);
 GuardaStore.prototype.setSetting=async function(key,value){if(key==='noteSortDirection')await gate;return original.call(this,key,value);};
 const wasAscending=$('note-sort-direction').classList.contains('is-ascending');
 let pending;try{
  pending=$('note-sort-direction').onclick();
  assert.equal($('note-sort-direction').classList.contains('is-ascending'),!wasAscending);
  assert.equal($('sort-direction-label').textContent,wasAscending?'Recientes':'Antiguas');
 }finally{release();await pending;GuardaStore.prototype.setSetting=original;}
});

await test('reading imported plain-text notes preserves dates and ordering through close and reopen',async()=>{
 const id='legacy-plain-reading',n={id,title:'Lectura de una nota antigua',body:'Primer párrafo\n\nSegundo párrafo',richBody:'',items:[],labels:[],attachments:[],isList:false,pinned:false,archived:false,deletedAt:null,color:'default',background:'none',createdAt:100,updatedAt:200,order:300};
 await store.putNote(n);channels[0].onmessage({data:{type:'note',id}});await until(()=>document.querySelector(`[data-note="${id}"]`));
 for(let i=0;i<2;i++){
  document.querySelector(`[data-note="${id}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!$('editor-layer').hidden);
  window.dispatchEvent(new window.Event('pagehide'));
  await $('editor-close').onclick();await until(()=>$('editor-layer').hidden);
  const saved=(await store.allNotes()).find(note=>note.id===id);assert.equal(saved.updatedAt,200);assert.equal(saved.order,300);assert.equal(saved.richBody,'');assert.equal(saved.body,n.body);
 }
});

await test('sort menu marks the selected criterion, supports keyboard closing and remembers direction per criterion',async()=>{
 $('note-sort').onclick();assert.equal($('note-sort').getAttribute('aria-expanded'),'true');assert.equal(document.querySelector('#sort-menu [aria-checked=true]').dataset.sortOption,'opened');
 let prevented=false,stopped=false;
 $('popover').onkeydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});assert.ok(prevented&&stopped);assert.ok($('popover').hidden);assert.equal($('note-sort').getAttribute('aria-expanded'),'false');
 $('note-sort').onclick();await $('popover').onclick({target:document.querySelector('[data-sort-option=created]')});assert.equal($('sort-direction-label').textContent,'Antiguas');
 $('note-sort').onclick();await $('popover').onclick({target:document.querySelector('[data-sort-option=modified]')});assert.equal($('sort-direction-label').textContent,'Recientes');
 document.dispatchEvent(new window.Event('click',{bubbles:true}));assert.ok($('popover').hidden);
 const directions=await store.getSetting('noteSortDirections');assert.equal(directions.created,'asc');
});
