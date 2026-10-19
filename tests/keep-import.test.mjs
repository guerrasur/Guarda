import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {zipSync,strToU8} from '../src/vendor/fflate.js';import {prepareKeepImport,readKeepFiles} from '../src/keep-import.js';import {GuardaStore} from '../src/storage.js';
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event{constructor(t,o={}){super(t);this.detail=o.detail;}};
const keep=(extra={})=>({title:'Idea de Keep',textContent:'Texto <b>literal</b> con tildes: canción',createdTimestampUsec:'1700000000000000',userEditedTimestampUsec:1700000010000000,isPinned:true,isArchived:true,color:'YELLOW',labels:[{name:'Ideas'}],...extra});
const file=(name,data)=>({name,size:data.length,arrayBuffer:async()=>Uint8Array.from(data).buffer});
const json=(name,value)=>file(name,strToU8(JSON.stringify(value)));
const zip=entries=>file('takeout.zip',zipSync(Object.fromEntries(Object.entries(entries).map(([name,data])=>[name,typeof data==='string'?strToU8(data):data]))));
let counter=0;async function store(t){const s=new GuardaStore({name:'keep-test-'+(++counter),broadcast:false});await s.init();t.after(()=>s.close());return s;}
test('Takeout ZIP preserves note text, dates, labels, colors, flags and exact image/audio bytes',async t=>{
 const s=await store(t);const source=keep({attachments:[{filePath:'voice.3gp',mimetype:'audio/3gpp'},{filePath:'drawing.png',mimetype:'image/png'}]});
 const input=zip({'Takeout/Keep/Nota.json':JSON.stringify(source),'Takeout/Keep/Nota.html':'<script>never execute</script>','Takeout/Keep/voice.3gp':strToU8('original audio'),'Takeout/Keep/drawing.png':new Uint8Array([137,80,78,71,0,1,2])});
 const staged=await prepareKeepImport([input]);assert.equal(staged.notes.length,1);assert.equal(staged.warnings.length,0);const n=staged.notes[0];assert.equal(n.body,source.textContent);assert.equal(n.richBody,'');assert.equal(n.createdAt,1700000000000);assert.equal(n.updatedAt,1700000010000);assert.equal(n.pinned,true);assert.equal(n.archived,true);assert.equal(n.color,'sand');
 const result=await s.addKeepImport(staged);assert.equal(result.imported,1);assert.equal(await (await s.getAttachment(n.attachments[0])).blob.text(),'original audio');assert.deepEqual(new Uint8Array(await (await s.getAttachment(n.attachments[1])).blob.arrayBuffer()),new Uint8Array([137,80,78,71,0,1,2]));const backup=await s.exportBackup();assert.equal(backup.notes[0].labels[0],backup.labels[0].id);
});
test('checklists preserve completed items; empty list metadata does not hide a text note',async()=>{
 const result=await prepareKeepImport([json('lista.json',keep({textContent:'',listContent:[{text:'Pan',isChecked:false},{text:'Leche',isChecked:true}]})),json('texto.json',keep({title:'Otra',listContent:[]}))]);
 assert.deepEqual(result.notes.find(n=>n.isList).items.map(i=>[i.text,i.checked]),[['Pan',false],['Leche',true]]);assert.equal(result.notes.find(n=>n.title==='Otra').isList,false);
});
test('repeat import skips identical notes even after the imported note was edited locally',async t=>{
 const s=await store(t),files=[json('note.json',keep())];const first=await prepareKeepImport(files);await s.addKeepImport(first);const n=(await s.allNotes())[0];await s.putNote({...n,title:'Mi título nuevo'});
 const repeat=await prepareKeepImport(files,{existingNotes:await s.allNotes(),existingLabels:await s.allLabels()});assert.equal(repeat.notes.length,0);assert.equal(repeat.skipped,1);await s.addKeepImport(repeat);assert.equal((await s.allNotes())[0].title,'Mi título nuevo');
});
test('missing files are reported before import and no remote attachment URLs are fetched',async()=>{
 const result=await prepareKeepImport([json('note.json',keep({attachments:[{filePath:'missing.jpg'},{filePath:'https://example.test/voice.mp3'}]}))]);assert.equal(result.notes.length,1);assert.equal(result.attachments.length,0);assert.equal(result.warnings.length,2);
});
test('additive import preserves existing notes and reuses label names without overwriting renamed labels',async t=>{
 const s=await store(t);await s.putNote({id:'existing',title:'No reemplazar',body:'Texto propio',items:[],attachments:[],labels:[]});await s.putLabel({id:'my-label',name:'IDEAS'});
 let staged=await prepareKeepImport([json('a.json',keep())],{existingNotes:await s.allNotes(),existingLabels:await s.allLabels()});assert.equal(staged.labels.length,0);assert.deepEqual(staged.notes[0].labels,['my-label']);await s.addKeepImport(staged);assert.equal((await s.allNotes()).find(n=>n.id==='existing').body,'Texto propio');assert.equal((await s.allLabels()).length,1);
 const another=await prepareKeepImport([json('b.json',keep({title:'Etiqueta nueva',labels:[{name:'Trabajo'}]}))],{existingLabels:await s.allLabels()});await s.putLabel({id:another.labels[0].id,name:'Etiqueta renombrada mientras preparaba'});await assert.rejects(s.addKeepImport(another),/etiquetas cambiaron/);assert.equal((await s.allNotes()).length,2);assert.ok((await s.allLabels()).some(l=>l.name==='Etiqueta renombrada mientras preparaba'));
});
test('same-name labels created during the preview are reused and concurrent reimport is idempotent',async t=>{
 const s=await store(t),staged=await prepareKeepImport([json('note.json',keep())]);await s.putLabel({id:'created-in-other-tab',name:'Ideas'});const first=await s.addKeepImport(staged);assert.equal(first.imported,1);assert.deepEqual((await s.allNotes())[0].labels,['created-in-other-tab']);const repeat=await s.addKeepImport(staged);assert.equal(repeat.imported,0);assert.equal(repeat.skipped,1);assert.equal((await s.allLabels()).length,1);
});
test('split archives combine attachments; invalid ZIP, oversized input and traversal paths are rejected',async()=>{
 const result=await prepareKeepImport([zip({'Takeout/Keep/note.json':JSON.stringify(keep({attachments:[{filePath:'voice.ogg'}]}))}),zip({'Takeout/Keep/voice.ogg':strToU8('opus bytes')})]);assert.equal(result.attachments.length,1);assert.equal(await result.attachments[0].blob.text(),'opus bytes');
 await assert.rejects(readKeepFiles([file('wrong.zip',strToU8('not zip'))]),/ZIP válido/);await assert.rejects(readKeepFiles([{name:'huge.zip',size:101*1024*1024}]),/100 MB/);await assert.rejects(readKeepFiles([zip({'../note.json':JSON.stringify(keep())})]),/ruta fuera/);
});
test('only Keep JSON is imported; incompatible files fail before modifying the store',async t=>{
 const s=await store(t);await assert.rejects(prepareKeepImport([json('config.json',{theme:'dark'})]),/No se encontraron/);await assert.rejects(prepareKeepImport([json('note.json',keep({listContent:[{text:5}]}))]),/no compatible/);assert.equal((await s.allNotes()).length,0);
});
