import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { GuardaStore } from '../src/storage.js';
import { DraftRecovery } from '../src/draft-recovery.js';
globalThis.indexedDB=indexedDB;
const storage=()=>{const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const note=(body='Primer verso\n\nSegundo verso')=>({id:'draft',title:'',body,richBody:'',items:[],labels:[],attachments:[],createdAt:1,updatedAt:10});
await test('an abrupt stop before any async write recovers the synchronous snapshot into a fresh database connection',async()=>{
 const local=storage();new DraftRecovery(local).capture(note());assert.equal(local.length,1);
 const db=new GuardaStore({name:'interrupted-text',broadcast:false});const recovered=await new DraftRecovery(local).recover(db);assert.deepEqual(recovered,['draft']);assert.equal((await db.allNotes())[0].body,note().body);assert.equal(local.length,0);db.close();
});
await test('completion of an older write cannot remove newer unsaved typing',()=>{const local=storage(),r=new DraftRecovery(local);const first=r.capture(note('A'));r.capture(note('B'));r.acknowledge('draft',first);assert.equal(JSON.parse(local.getItem(local.key(0))).body,'B');});
await test('failed recovery leaves its safety copy available for retry',async()=>{const local=storage(),r=new DraftRecovery(local);r.capture(note());await assert.rejects(r.recover({allNotes:async()=>[],putNote:async()=>{throw Error('disk full');}}));assert.equal(local.length,1);});
await test('newer stored edits and deleted notes are retained alongside recovered text',async()=>{
 for(const deletedAt of [null,30]){const local=storage(),r=new DraftRecovery(local),db=new GuardaStore({name:'concurrent-'+deletedAt,broadcast:false});await db.putNote({...note('Otra edición'),updatedAt:20,deletedAt});r.capture(note());await r.recover(db);const notes=await db.allNotes();assert.equal(notes.length,2);assert.equal(notes.find(n=>n.id==='draft').body,'Otra edición');assert.equal(notes.find(n=>n.id!=='draft').body,note().body);db.close();}
});
