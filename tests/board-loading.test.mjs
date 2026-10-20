import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';import {indexedDB} from 'fake-indexeddb';import {GuardaStore} from '../src/storage.js';
const nativeTimeout=setTimeout,nativeInterval=setInterval;
const {document,window}=parseHTML(await readFile('index.html','utf8'));
Object.assign(globalThis,{document,window,indexedDB,innerWidth:1365,innerHeight:900,location:{hash:''},matchMedia:()=>({matches:false,addEventListener(){}}),BroadcastChannel:class{postMessage(){}close(){}}});
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Test',storage:{persist:async()=>true}},configurable:true});
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event{constructor(type,options={}){super(type);this.detail=options.detail;}};
globalThis.setInterval=(...args)=>{const timer=nativeInterval(...args);timer.unref();return timer;};globalThis.setTimeout=(...args)=>{const timer=nativeTimeout(...args);timer.unref();return timer;};
for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;}
const store=new GuardaStore({broadcast:false});await store.init();
for(const [id,archived,deletedAt] of [['visible',false,null],['archived',true,null],['deleted',false,1]]){
 const note={id,title:id,body:'Texto',richBody:'',items:[],labels:[],attachments:[id+'-file'],isList:false,pinned:false,archived,deletedAt,color:'default',background:'none',createdAt:1,updatedAt:1,order:1};
 await store.attachToNote(note,{id:id+'-file',noteId:id,name:id+'.pdf',type:id==='deleted'?'image/png':'application/pdf',blob:new Blob(['%PDF test'])});
}
const reads=[],original=GuardaStore.prototype.getAttachment;GuardaStore.prototype.getAttachment=function(id){reads.push(id);return original.call(this,id);};
await import('../src/app.js');
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(resolve=>nativeTimeout(resolve,10));}throw Error('Board did not update');}
await test('startup loads visible attachments once and leaves archive/trash files unloaded until visited',async()=>{
 await until(()=>document.querySelector('[data-note=visible]'));assert.deepEqual(reads,['visible-file']);
 document.getElementById('view-toggle').onclick();await new Promise(resolve=>nativeTimeout(resolve,10));assert.deepEqual(reads,['visible-file']);
 document.querySelector('[data-route=archive]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>document.querySelector('[data-note=archived]'));assert.deepEqual(reads,['visible-file','archived-file']);
 document.querySelector('[data-route=trash]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>document.querySelector('[data-note=deleted]'));assert.deepEqual(reads,['visible-file','archived-file','deleted-file']);
});
await test('permanently removed notes release their cached image URL',async()=>{
 const image=document.querySelector('[data-note=deleted] img'),url=image.getAttribute('src'),revoked=[],originalRevoke=URL.revokeObjectURL;
 URL.revokeObjectURL=value=>{revoked.push(value);originalRevoke.call(URL,value);};
 try{
  document.querySelector('[data-note=deleted] [data-action=delete]').dispatchEvent(new window.Event('click',{bubbles:true}));
  document.querySelector('[data-dialog-action="1"]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!document.querySelector('[data-note=deleted]'));assert.ok(revoked.includes(url));
 }finally{URL.revokeObjectURL=originalRevoke;}
});
store.close();
