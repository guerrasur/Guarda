import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createNotebook, editPage, pageText, pageSpace, PAGE_CAPACITY, validateNotebook } from '../src/notebook.js';
import { GuardaStore } from '../src/storage.js';
import { DraftRecovery } from '../src/draft-recovery.js';
import { backupUnits, localRecords, materialize } from '../src/cloud-merge.js';
globalThis.indexedDB=indexedDB;
globalThis.CustomEvent ??= class extends Event {constructor(type, options){super(type);this.detail=options?.detail;}};
const ink=text=>editPage([],{start:0,text}).page;

test('a notebook has exactly 25 ordered pages and a constant 250-character capacity',()=>{
 const book=createNotebook('  Ideas  ');assert.equal(book.title,'Ideas');assert.equal(book.notebook.pageCount,25);assert.deepEqual(book.notebook.pages,[[]]);
 const page=ink('a'.repeat(PAGE_CAPACITY));assert.equal(pageSpace(page),250);assert.throws(()=>editPage(page,{start:250,text:'b'}),/espacio/);validateNotebook({...book,notebook:{...book.notebook,pages:[page]}});
});
test('backspace, forward delete, selections and repeated deletion retain all ink and never reclaim capacity',()=>{
 const original=ink('Hola mundo');let result=editPage(original,{start:4,deletion:'deleteContentBackward'});assert.equal(pageText(result.page),'Hola mundo');assert.equal(result.page[3].struck,true);assert.equal(result.caret,3);
 result=editPage(result.page,{start:4,deletion:'deleteContentBackward'});assert.equal(result.page[2].struck,true);
 result=editPage(result.page,{start:5,end:10,deletion:'deleteByCut'});assert.ok(result.page.slice(5).every(i=>i.struck));assert.equal(pageSpace(result.page),10);
 const full=ink('x'.repeat(250));const crossed=editPage(full,{start:0,end:250,deletion:'deleteContentForward'}).page;assert.equal(pageSpace(crossed),250);assert.throws(()=>editPage(crossed,{start:0,text:'a'}),/espacio/);assert.equal(original[3].struck,false);
});
test('replacement strikes old text and appends new ink; an overflowing paste changes nothing',()=>{
 const page=ink('La casa');const result=editPage(page,{start:3,end:7,text:'luna'});assert.equal(pageText(result.page),'La casaluna');assert.ok(result.page.slice(3,7).every(i=>i.struck));assert.equal(result.caret,11);
 assert.throws(()=>editPage(page,{start:0,end:2,text:'x'.repeat(250)}),/espacio/);assert.equal(pageText(page),'La casa');assert.ok(page.every(i=>!i.struck));
});
test('line breaks consume the remaining row, including consecutive breaks, without overflowing the screen',()=>{
 assert.equal(pageSpace(ink('Hola\nmundo')),30);assert.equal(pageSpace(ink('a'.repeat(25)+'\nb')),26);
 assert.equal(pageSpace(ink('\n'.repeat(9)+'x'.repeat(25))),250);
 assert.throws(()=>ink('\n'.repeat(10)),/espacio/);assert.equal(pageSpace(ink('a'.repeat(50)+'\n')),50);
});
test('Unicode offsets retain emoji and normalize pasted CRLF and tabs',()=>{
 const page=ink('Á🙂\r\n\tfin');assert.equal(pageText(page),'Á🙂\n    fin');assert.equal(page[1].char,'🙂');
 const result=editPage(page,{start:1,end:2,deletion:'deleteContentBackward'});assert.equal(result.page[1].struck,true);assert.equal(pageSpace(result.page),32);
});
test('notebooks, strikes and page order survive backup, recovery and Drive records',async()=>{
 const store=new GuardaStore({name:'notebook-test',broadcast:false});const book=createNotebook('Cuaderno');book.notebook.pages=[ink('Primera'),[],editPage(ink('Tercera'),{start:0,end:7,deletion:'deleteContentBackward'}).page];
 await store.putNote(book);const backup=await store.exportBackup();assert.ok(backupUnits(backup).has('note:'+book.id));
 const records=await localRecords(backup,{},'device');assert.deepEqual(materialize(records).notes[0].notebook,book.notebook);
 const memory=new Map();const storage={get length(){return memory.size;},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const recovery=new DraftRecovery(storage);book.updatedAt+=100;book.notebook.pages[1]=ink('Interrumpida');recovery.capture(book);await recovery.recover(store);assert.deepEqual((await store.allNotes())[0].notebook,book.notebook);
 const other=new GuardaStore({name:'notebook-import',broadcast:false});await other.importBackup(await store.exportBackup());assert.deepEqual((await other.allNotes())[0].notebook,book.notebook);store.close();other.close();
});
test('invalid notebook data is rejected before it can replace stored content',async()=>{
 const store=new GuardaStore({name:'notebook-invalid',broadcast:false});const book=createNotebook('Seguro');await store.putNote(book);
 const invalid=structuredClone(book);invalid.notebook.pages=[Array.from({length:251},()=>({char:'x',struck:false}))];await assert.rejects(()=>store.putNote(invalid),/formato/);assert.deepEqual((await store.allNotes())[0].notebook,book.notebook);store.close();
});

 test('creation offers 25, 50 or 100 sheets and 200 or 250 characters without using screen size',()=>{
  for(const pageCount of [25,50,100])for(const capacity of [200,250]){const book=createNotebook('Tamaño',{pageCount,capacity});assert.equal(book.notebook.pageCount,pageCount);const page=editPage([],{start:0,text:'x'.repeat(capacity),...book.notebook}).page;assert.equal(pageSpace(page,book.notebook),capacity);validateNotebook({...book,notebook:{...book.notebook,pages:[page]}});assert.throws(()=>editPage(page,{start:capacity,text:'!',...book.notebook}),/espacio/);}
  assert.throws(()=>createNotebook('Inválido',{pageCount:101}),/tamaño/);
 });
