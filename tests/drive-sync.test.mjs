import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {GuardaStore} from '../src/storage.js';import {DriveSync} from '../src/drive-sync.js';
import {mergeRecords,materialize,validateRelease} from '../src/cloud-merge.js';
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event{constructor(t,o={}){super(t);this.detail=o.detail;}};
const note=(id,body='Texto')=>({id,title:id,body,items:[],labels:[],attachments:[],isList:false,pinned:false,archived:false,deletedAt:null,createdAt:1,updatedAt:1,order:1});
let index=0;
async function fixture(t){
 const files=new Map();let uploads=0,lock=Promise.resolve();
 const env={crypto,navigator:{locks:{request:(_name,run)=>{const next=lock.then(run);lock=next.catch(()=>{});return next;}}}};
 async function device(account='person-1'){
  const store=new GuardaStore({name:'cloud-test-'+(++index),broadcast:false});await store.init();t.after(()=>store.close());
  const client={connected:true,user:{permissionId:account},listSnapshots:async()=>[...files.keys()].map(id=>({id})),readSnapshot:async id=>structuredClone(files.get(id)),writeSnapshot:async(device,payload,id)=>{uploads++;id=id||'file-'+files.size;files.set(id,structuredClone(payload));return id;}};
  const sync=new DriveSync({store,client,env});return {store,client,sync};
 }
 return {files,device,get uploads(){return uploads;}};
}
test('two devices synchronize notes, labels and exact audio bytes without sharing settings',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();const n=note('idea');n.labels=['tag'];n.attachments=['audio'];await a.store.putLabel({id:'tag',name:'Ideas'});await a.store.attachToNote(n,{id:'audio',noteId:n.id,type:'audio/mp4',name:'Voz',blob:new Blob(['original voice bytes'],{type:'audio/mp4'})});await a.store.setSetting('theme','dark');
 await a.sync.sync();await b.sync.sync();assert.equal((await b.store.allNotes())[0].body,'Texto');assert.equal((await b.store.allLabels())[0].name,'Ideas');assert.equal(await (await b.store.getAttachment('audio')).blob.text(),'original voice bytes');assert.equal(await b.store.getSetting('theme','system'),'system');
 const text=JSON.stringify([...f.files.values()]);assert.doesNotMatch(text,/drive-bound-account|drive-client-id|Bearer|access_token|"theme"/);
 const count=f.uploads;await a.sync.sync();const stable=f.uploads;await a.sync.sync();assert.equal(f.uploads,stable,'unchanged data must not be re-uploaded');assert.ok(stable>=count);
});
test('concurrent offline edits keep both versions and converge on both devices',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('same','Original'));await a.sync.sync();await b.sync.sync();
 await a.store.putNote(note('same','Edición A'));await b.store.putNote(note('same','Edición B'));await a.sync.sync();await b.sync.sync();await a.sync.sync();await b.sync.sync();
 const first=await a.store.allNotes(),second=await b.store.allNotes();assert.deepEqual(new Set(first.map(n=>n.body)),new Set(['Edición A','Edición B']));assert.equal(first.length,2);assert.deepEqual(first.map(n=>n.id).sort(),second.map(n=>n.id).sort());
 const copy=first.find(n=>n.id!=='same');await a.store.deleteNote(copy.id);await a.sync.sync();await b.sync.sync();await a.sync.sync();assert.equal((await a.store.allNotes()).length,1,'resolved conflict copies must not reappear after deletion');assert.equal((await b.store.allNotes()).length,1);
});
test('permanent deletion propagates without resurrecting notes from stale devices',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('delete-me'));await a.sync.sync();await b.sync.sync();await a.store.deleteNote('delete-me');await a.sync.sync();await b.sync.sync();assert.deepEqual(await b.store.allNotes(),[]);await a.sync.sync();assert.deepEqual(await a.store.allNotes(),[]);
});
test('new local edits during network activity are never overwritten by downloaded data',async t=>{
 const f=await fixture(t),a=await f.device();await a.store.putNote(note('race','Antes'));const upload=a.client.writeSnapshot;
 a.client.writeSnapshot=async(...args)=>{const id=await upload(...args);await a.store.putNote(note('race','Texto que escribí durante la subida'));return id;};
 await assert.rejects(a.sync.sync(),error=>error.cause?.code==='SYNC_LOCAL_CHANGED');assert.equal((await a.store.allNotes())[0].body,'Texto que escribí durante la subida');a.client.writeSnapshot=upload;await a.sync.sync();assert.ok((await a.store.allNotes()).some(n=>n.body==='Texto que escribí durante la subida'));
});
test('offline failures preserve local data and retry successfully; a different account is blocked before upload',async t=>{
 const f=await fixture(t),a=await f.device();await a.store.putNote(note('safe'));const upload=a.client.writeSnapshot;a.client.writeSnapshot=async()=>{throw Error('Offline');};await assert.rejects(a.sync.sync(),/Offline/);assert.equal((await a.store.allNotes()).length,1);a.client.writeSnapshot=upload;await a.sync.sync();const count=f.uploads;a.client.user={permissionId:'other-account'};await assert.rejects(a.sync.sync(),/otra cuenta/);assert.equal(f.uploads,count);assert.equal((await a.store.allNotes()).length,1);
});
test('busy editors postpone sync and corrupt cloud data is rejected before changing local or remote records',async t=>{
 const f=await fixture(t),a=await f.device();await a.store.putNote(note('safe'));a.sync.isBusy=()=>true;await assert.rejects(a.sync.sync(),/Cerrá la nota/);assert.equal(f.uploads,0);a.sync.isBusy=()=>false;
 f.files.set('bad',{format:'guarda-drive-sync',version:1,device:'other',records:[{key:'note:bad',clock:{other:1},deleted:false,value:{note:{id:'bad'},attachments:[]}}]});await assert.rejects(a.sync.sync(),/texto|válido/i);assert.equal(f.uploads,0);assert.equal((await a.store.allNotes())[0].id,'safe');
});
test('normal backups omit device/account metadata and restoration generates no duplicate device identity',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('safe'));await a.sync.sync();const backup=await a.store.exportBackup();assert.ok(backup.settings.every(r=>!r.id.startsWith('drive-')));await b.store.importBackup(backup);assert.equal(await b.store.getSetting('drive-device',null),null);
});
test('vector clocks reject invalid files and a concurrent deletion preserves a live edit',async()=>{
 assert.throws(()=>validateRelease({format:'guarda-drive-sync',version:1,records:[{key:'note:a',clock:{a:-1},deleted:true,value:null}]}));
 const value={note:note('a','Edición offline'),attachments:[]};const result=await mergeRecords([[{key:'note:a',clock:{a:2},deleted:true,value:null}],[{key:'note:a',clock:{a:1,b:1},deleted:false,value}]]);assert.equal(materialize(result.records).notes[0].body,'Edición offline');
});
test('conflicting notes retain both original audio files and consistent attachment links',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('voice'));await a.sync.sync();await b.sync.sync();
 for(const [d,id,bytes] of [[a,'audio-a','voice A'],[b,'audio-b','voice B']]){const n=(await d.store.allNotes())[0];n.body=bytes;await d.store.attachToNote(n,{id,noteId:n.id,type:'audio/mp4',name:id,blob:new Blob([bytes],{type:'audio/mp4'})});}
 await a.sync.sync();await b.sync.sync();await a.sync.sync();
 const notes=await a.store.allNotes();assert.equal(notes.length,2);const sounds=[];for(const n of notes){assert.equal(n.attachments.length,1);const audio=await a.store.getAttachment(n.attachments[0]);assert.equal(audio.noteId,n.id);sounds.push(await audio.blob.text());}assert.deepEqual(sounds.sort(),['voice A','voice B']);
});

test('opening an editor while downloading defers safely and resumes without another authorization',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('remote'));await a.sync.sync();await b.store.putNote(note('local'));
 let busy=false;const read=b.client.readSnapshot;b.sync.isBusy=()=>busy;b.client.readSnapshot=async id=>{const data=await read(id);busy=true;return data;};
 await assert.rejects(b.sync.sync(),error=>error.code==='SYNC_DEFERRED');assert.equal(b.client.connected,true);assert.deepEqual((await b.store.allNotes()).map(n=>n.id),['local']);
 b.client.readSnapshot=read;busy=false;await b.sync.sync();assert.deepEqual(new Set((await b.store.allNotes()).map(n=>n.id)),new Set(['local','remote']));
});
test('arbitrary file attachments preserve original names, MIME and exact bytes across Drive and backup restoration',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device(),c=await f.device();const n=note('files');
 const file={id:'document',noteId:n.id,name:'Escena.pdf',type:'application/pdf',originalFile:true,blob:new Blob([new Uint8Array([37,80,68,70,0,255,128])],{type:'application/pdf'})};await a.store.attachToNote(n,file);await a.sync.sync();await b.sync.sync();
 const remote=await b.store.getAttachment(file.id);assert.equal(remote.name,file.name);assert.equal(remote.type,file.type);assert.equal(remote.originalFile,true);assert.deepEqual(new Uint8Array(await remote.blob.arrayBuffer()),new Uint8Array(await file.blob.arrayBuffer()));
 const backup=await b.store.exportBackup();await c.store.importBackup(backup);assert.deepEqual(new Uint8Array(await (await c.store.getAttachment(file.id)).blob.arrayBuffer()),new Uint8Array(await file.blob.arrayBuffer()));
});
test('folder migration runs after validation and can retry without losing the local copy',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('remote-file'));await a.sync.sync();await b.store.putNote(note('local-file'));let fail=true,moves=0,folders=0;
 b.client.ensureFolder=async()=>folders++;b.client.placeSnapshot=async()=>{moves++;if(fail)throw Object.assign(Error('Drive temporalmente ocupado'),{code:'DRIVE_RETRYABLE'});};
 await assert.rejects(b.sync.sync(),error=>error.code==='DRIVE_RETRYABLE');assert.deepEqual((await b.store.allNotes()).map(n=>n.id),['local-file']);fail=false;await b.sync.sync();assert.ok(moves>=2);assert.equal(folders,2);assert.deepEqual(new Set((await b.store.allNotes()).map(n=>n.id)),new Set(['local-file','remote-file']));
 f.files.set('bad',{format:'invalid'});const before=moves;await assert.rejects(b.sync.sync());assert.equal(moves,before,'invalid releases must not be moved or overwritten');
});
test('duplicate snapshots from one device converge without blocking synchronization or deleting historical files',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('same-device','Original'));await a.sync.sync();const [id,release]=[...f.files.entries()][0];f.files.set('duplicate-copy',structuredClone(release));
 await a.store.putNote(note('same-device','Edición posterior'));await a.sync.sync();await a.sync.sync();await b.sync.sync();assert.equal((await a.store.allNotes()).length,1);assert.equal((await b.store.allNotes())[0].body,'Edición posterior');assert.ok(f.files.has(id));assert.ok(f.files.has('duplicate-copy'));
});
test('audio waveform metadata survives Drive synchronization and backup restoration unchanged',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device(),c=await f.device();const n=note('wave');const waveform={version:1,duration:2,peaks:[0,.25,1,.4,0]};
 await a.store.attachToNote(n,{id:'audio-wave',noteId:n.id,type:'audio/mpeg',name:'Voz',duration:2,waveform,blob:new Blob(['audio bytes'],{type:'audio/mpeg'})});await a.sync.sync();await b.sync.sync();assert.deepEqual((await b.store.getAttachment('audio-wave')).waveform,waveform);await c.store.importBackup(await b.store.exportBackup());assert.deepEqual((await c.store.getAttachment('audio-wave')).waveform,waveform);
});
test('open editors upload repeated edits without applying remote notes or generating conflicts',async t=>{
 const f=await fixture(t),a=await f.device(),b=await f.device();await a.store.putNote(note('remote','Desde otro dispositivo'));await a.sync.sync();
 b.sync.isBusy=()=>true;b.sync.isUploadBusy=()=>false;
 for(const body of ['Uno','Dos','Tres']){await b.store.putNote(note('open',body));const result=await b.sync.sync();assert.equal(result.uploadOnly,true);assert.deepEqual((await b.store.allNotes()).map(n=>n.id),['open']);}
 await a.sync.sync();assert.equal((await a.store.allNotes()).find(n=>n.id==='open').body,'Tres');assert.equal((await a.store.allNotes()).length,2);
 b.sync.isBusy=()=>false;await b.sync.sync();assert.equal((await b.store.allNotes()).length,2);
});
test('edits during an editor upload retain local text and retry with correct vector clocks',async t=>{
 const f=await fixture(t),a=await f.device();await a.store.putNote(note('editing','Antes'));a.sync.isBusy=()=>true;a.sync.isUploadBusy=()=>false;const upload=a.client.writeSnapshot;
 a.client.writeSnapshot=async(...args)=>{const id=await upload(...args);await a.store.putNote(note('editing','Durante'));return id;};
 await assert.rejects(a.sync.sync(),e=>e.cause?.code==='SYNC_LOCAL_CHANGED');assert.equal((await a.store.allNotes())[0].body,'Durante');a.client.writeSnapshot=upload;await a.sync.sync();
 assert.ok([...f.files.values()].some(f=>f.records.some(r=>r.value?.note?.body==='Durante')));
});
