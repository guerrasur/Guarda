import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {compareNotes,renderNoteGroups} from '../src/note-board.js';
function fixture(){const {document}=parseHTML('<html><body><main></main></body></html>');const area=document.querySelector('main');let builds=0;return {area,get builds(){return builds;},render:groups=>renderNoteGroups(area,groups,{keyOf:note=>JSON.stringify(note),renderCard:note=>{builds++;return `<article data-note="${note.id}"><h3>${note.title}</h3><input></article>`;}})};}
const group=(notes,id='all')=>({id,label:id==='all'?'':'Fijadas',notes});
test('updating one note preserves every unchanged card and its inputs',()=>{
 const f=fixture(),a={id:'a',title:'A'},b={id:'b',title:'B'};f.render([group([a,b])]);const first=f.area.querySelector('[data-note=a]'),input=first.querySelector('input');input.value='Preservar';
 f.render([group([a,{...b,title:'B editada'}])]);assert.equal(f.area.querySelector('[data-note=a]'),first);assert.equal(first.querySelector('input'),input);assert.equal(input.value,'Preservar');assert.equal(f.builds,3);
});
test('reordering and moving between pinned groups never duplicate or rebuild unchanged notes',()=>{
 const f=fixture(),a={id:'a',title:'A'},b={id:'b',title:'B'};f.render([group([a,b])]);const first=f.area.querySelector('[data-note=a]');
 f.render([group([b,a])]);assert.deepEqual([...f.area.querySelectorAll('[data-note]')].map(n=>n.dataset.note),['b','a']);
 f.render([group([a],'pinned'),group([b],'other')]);assert.equal(f.area.querySelector('[data-note=a]'),first);assert.equal(f.area.querySelectorAll('[data-note]').length,2);assert.equal(f.builds,2);
 f.render([group([b])]);assert.equal(f.area.querySelectorAll('section').length,1);assert.equal(f.area.querySelector('[data-note=a]'),null);assert.equal(f.builds,2);
});
test('unchanged large boards avoid reparsing their content',()=>{
 const f=fixture(),notes=Array.from({length:300},(_,i)=>({id:String(i),title:'Nota '+i}));f.render([group(notes)]);f.render([group(notes)]);assert.equal(f.builds,300);assert.equal(f.area.querySelectorAll('[data-note]').length,300);
});

test('date sorting uses each selected timestamp in both directions without changing notes',()=>{
 const notes=[{id:'a',createdAt:1,updatedAt:30},{id:'b',createdAt:3,updatedAt:10},{id:'c',createdAt:2,updatedAt:20}];
 const before=JSON.stringify(notes),opened={a:5,b:9};
 for(const [mode,desc,asc] of [['created','bca','acb'],['modified','acb','bca'],['opened','bac','abc']]){
  for(const [direction,want] of [['desc',desc],['asc',asc]])assert.equal([...notes].sort((a,b)=>compareNotes(a,b,mode,direction,opened)).map(n=>n.id).join(''),want);
 }
 assert.equal(JSON.stringify(notes),before);
});
