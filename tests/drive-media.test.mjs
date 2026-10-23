import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { DriveClient } from '../src/drive-client.js';
import { DriveSync } from '../src/drive-sync.js';
import { GuardaStore } from '../src/storage.js';
import { fingerprint } from '../src/cloud-merge.js';
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event{constructor(type,options={}){super(type);this.detail=options.detail;}};
const note={id:'note',title:'Idea',body:'Original',labels:[],items:[],attachments:[],createdAt:1,updatedAt:1};
let sequence=0;
function drive(){
 const files=new Map(),sessions=new Map(),uploads=[],downloads=[];let failMedia=false;
 const fetch=async(url,options)=>{
  const u=new URL(url),method=options.method;
  if(u.searchParams.has('uploadType')){const metadata=JSON.parse(options.body);const id=method==='PATCH'?u.pathname.split('/').at(-1):'file-'+(++sequence);const key='session-'+(++sequence);sessions.set(key,{id,metadata});return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id='+key}});}
  if(method==='PUT'){const session=sessions.get(u.searchParams.get('upload_id'));if(failMedia&&session.metadata.appProperties?.guarda==='media-v1')throw new TypeError('offline');const bytes=new Uint8Array(await options.body.arrayBuffer());uploads.push({id:session.id,bytes,metadata:session.metadata});files.set(session.id,{...files.get(session.id),...session.metadata,id:session.id,size:String(bytes.length),bytes,modifiedTime:String(++sequence)});return Response.json({id:session.id});}
  if(u.pathname.endsWith('/files')&&method==='GET'){const q=u.searchParams.get('q'),kind=q.includes('media-v1')?'media-v1':q.includes('folder-v1')?'folder-v1':'sync-v1';return Response.json({files:[...files.values()].filter(f=>f.appProperties?.guarda===kind).map(({bytes,...f})=>f)});}
  if(u.pathname.endsWith('/files')&&method==='POST'){const metadata=JSON.parse(options.body),id='folder-'+(++sequence);files.set(id,{...metadata,id});return Response.json({id});}
  const id=u.pathname.split('/').at(-1),file=files.get(id);if(!file)return new Response(null,{status:404});
  if(method==='PATCH'){const changes=JSON.parse(options.body);Object.assign(file,changes);if(u.searchParams.has('addParents'))file.parents=[u.searchParams.get('addParents')];return Response.json({id});}
  downloads.push(id);return new Response(file.bytes);
 };
 function client(){const c=new DriveClient({env:{fetch,AbortController,setTimeout,clearTimeout}});c.token='test';c.expires=Date.now()+3600000;c.user={permissionId:'owner',emailAddress:'owner@example.test'};c.identityVerified=true;return c;}
 async function device(t){const store=new GuardaStore({name:'media-'+(++sequence),broadcast:false});await store.init();t.after(()=>store.close());const c=client();const sync=new DriveSync({store,client:c,env:{crypto,navigator:{locks:{request:(_key,run)=>run()}}}});return {store,client:c,sync};}
 return {files,uploads,downloads,client,device,setFailMedia:value=>failMedia=value};
}
test('real sync transport migrates inline media, reuses exact bytes across reloads and uploads only JSON on text edits',async t=>{
 const f=drive(),a=await f.device(t);const bytes=new Uint8Array([0,255,128,37,80,68,70]);
 await a.store.attachToNote(note,{id:'pdf',noteId:note.id,name:'Guion.pdf',type:'application/pdf',blob:new Blob([bytes],{type:'application/pdf'})});
 await a.sync.sync();let media=f.uploads.filter(u=>u.metadata.appProperties?.guarda==='media-v1');assert.equal(media.length,1);assert.deepEqual(media[0].bytes,bytes);assert.equal(media[0].metadata.name,'Guion.pdf');
 const manifest=()=>JSON.parse(new TextDecoder().decode([...f.files.values()].find(v=>v.appProperties?.guarda==='sync-v1').bytes));
 assert.equal(manifest().version,2);assert.equal(manifest().records[0].value.attachments[0].data,undefined);assert.equal(manifest().records[0].value.attachments[0].media.fileId,media[0].id);
 const b=await f.device(t);await b.sync.sync();assert.deepEqual(new Uint8Array(await (await b.store.getAttachment('pdf')).blob.arrayBuffer()),bytes);assert.equal(f.downloads.filter(id=>id===media[0].id).length,1);
 // A fresh client represents reloading the app; local media seeds the download cache.
 a.sync.client=f.client();a.sync.downloads.clear();await a.store.putNote({...(await a.store.allNotes())[0],body:'Changed text'});const before=f.uploads.length;await a.sync.sync();
 assert.equal(f.uploads.length,before+1);assert.equal(f.uploads.at(-1).metadata.name.startsWith('Guarda-'),true);assert.equal(f.downloads.filter(id=>id===media[0].id).length,1);
 await b.sync.sync();assert.equal((await b.store.allNotes())[0].body,'Changed text');assert.equal(f.uploads.filter(u=>u.metadata.appProperties?.guarda==='media-v1').length,1);
 const stable=f.uploads.length;await b.sync.sync();assert.equal(f.uploads.length,stable);
});
test('legacy snapshots migrate even when unchanged; a failed media upload never replaces the inline backup',async t=>{
 const f=drive(),a=await f.device(t);await a.store.attachToNote(note,{id:'voice',noteId:note.id,name:'Voz.mp3',type:'audio/mpeg',blob:new Blob(['voice'],{type:'audio/mpeg'})});
 // Publish a v1 release using the previous transport, then persist its vector heads.
 const modern=a.client.externalizeMedia;a.client.externalizeMedia=async payload=>payload;await a.sync.sync();a.client.externalizeMedia=modern;
 const snapshot=[...f.files.values()].find(v=>v.appProperties?.guarda==='sync-v1'),original=snapshot.bytes;
 f.setFailMedia(true);await assert.rejects(a.sync.sync(),e=>e.code==='DRIVE_RETRYABLE');assert.deepEqual(snapshot.bytes,original);assert.equal(await (await a.store.getAttachment('voice')).blob.text(),'voice');
 f.setFailMedia(false);await a.sync.sync();const migrated=JSON.parse(new TextDecoder().decode(f.files.get(snapshot.id).bytes));assert.equal(migrated.version,2);assert.equal(migrated.records[0].value.attachments[0].data,undefined);
});
test('corrupt, missing, oversized and malformed media references are rejected without changing local notes',async t=>{
 const f=drive(),a=await f.device(t);await a.store.attachToNote(note,{id:'image',noteId:note.id,name:'Foto.png',type:'image/png',blob:new Blob(['image'],{type:'image/png'})});await a.sync.sync();
 const snapshot=[...f.files.values()].find(v=>v.appProperties?.guarda==='sync-v1'),wire=JSON.parse(new TextDecoder().decode(snapshot.bytes)),ref=wire.records[0].value.attachments[0].media;
 const media=f.files.get(ref.fileId),original=media.bytes;media.bytes=new TextEncoder().encode('wrong');
 const b=await f.device(t);await b.store.putNote({...note,id:'safe'});await assert.rejects(b.sync.sync(),/dañado/);assert.deepEqual((await b.store.allNotes()).map(n=>n.id),['safe']);
 media.bytes=new Uint8Array(original.length+1);await assert.rejects(b.sync.sync(),/dañado/);media.bytes=original;
 f.files.delete(ref.fileId);await assert.rejects(b.sync.sync(),e=>e.code==='DRIVE_RETRYABLE');
 for(const bad of [{...ref,fileId:'https://bad.test'},{...ref,size:-1},{...ref,size:201*1024*1024},{...ref,hash:'invalid'}]){const copy=structuredClone(wire);copy.records[0].value.attachments[0].media=bad;snapshot.bytes=new TextEncoder().encode(JSON.stringify(copy));await assert.rejects(b.sync.sync(),/dañado/);}
 assert.deepEqual((await b.store.allNotes()).map(n=>n.id),['safe']);
});
test('identical attachments share one Drive object; a changed binary uploads a new object and keeps old references intact',async()=>{
 const f=drive(),c=f.client(),data=btoa('original');const payload={format:'guarda-drive-sync',version:1,device:'a',records:[{key:'note:note',clock:{a:1},deleted:false,value:{note:{...note,attachments:['one','two']},attachments:[{id:'one',noteId:'note',name:'One.txt',type:'text/plain',data},{id:'two',noteId:'note',name:'Two.txt',type:'text/plain',data}]}}]};
 await c.writeSnapshot('a',payload);assert.equal(f.uploads.filter(u=>u.metadata.appProperties?.guarda==='media-v1').length,1);assert.equal(payload.records[0].value.attachments[0].data,data);
 const oldId=[...f.files.values()].find(v=>v.appProperties?.guarda==='media-v1').id;payload.records[0].value.attachments[0].data=btoa('changed');await c.prepareMedia({attachments:[]});await c.writeSnapshot('a',payload);
 assert.equal(f.uploads.filter(u=>u.metadata.appProperties?.guarda==='media-v1').length,2);assert.equal(new TextDecoder().decode(f.files.get(oldId).bytes),'original');
 // Local cache is isolated by account, and unknown bytes must pass the digest check.
 await c.prepareMedia({attachments:[{data}]});c.user={permissionId:'other'};c.checkMediaAccount();assert.equal(c.mediaData.size,0);assert.equal(await fingerprint(data),f.files.get(oldId).appProperties.hash);
});
test('concurrent edits preserve conflict attachments while sharing unchanged binary objects',async t=>{
 const f=drive(),a=await f.device(t),b=await f.device(t);await a.store.attachToNote(note,{id:'voice',noteId:note.id,name:'Voz.mp3',type:'audio/mpeg',blob:new Blob(['original audio'],{type:'audio/mpeg'})});await a.sync.sync();await b.sync.sync();
 await a.store.putNote({...((await a.store.allNotes())[0]),body:'Offline A'});await b.store.putNote({...((await b.store.allNotes())[0]),body:'Offline B'});await a.sync.sync();await b.sync.sync();await a.sync.sync();await b.sync.sync();
 assert.deepEqual(new Set((await b.store.allNotes()).map(n=>n.body)),new Set(['Offline A','Offline B']));
 for(const n of await b.store.allNotes()){const attachment=await b.store.getAttachment(n.attachments[0]);assert.equal(attachment.noteId,n.id);assert.equal(await attachment.blob.text(),'original audio');}
 assert.equal(f.uploads.filter(u=>u.metadata.appProperties?.guarda==='media-v1').length,1);
});
