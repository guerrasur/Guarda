import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { indexedDB } from 'fake-indexeddb';
import { GuardaStore } from '../src/storage.js';
import { createNotebook } from '../src/notebook.js';
import { initNotebooks } from '../src/notebook-ui.js';
const {document,window}=parseHTML('<html><body></body></html>');
const memory=new Map();
Object.assign(globalThis,{document,window,indexedDB,localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}});
globalThis.CustomEvent ??= class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
window.HTMLElement.prototype.showModal=function(){this.open=true;};
window.HTMLElement.prototype.close=function(){this.open=false;};
window.HTMLElement.prototype.getBoundingClientRect=()=>({width:375,height:600});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(value){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.getAttribute('value')===value);},configurable:true});
window.HTMLTextAreaElement.prototype.setSelectionRange=function(start,end){this.selectionStart=start;this.selectionEnd=end;};
const viewport=new EventTarget();Object.assign(viewport,{height:800,width:375,offsetTop:0,offsetLeft:0});globalThis.visualViewport=viewport;
const restoredScroll=[];globalThis.scrollTo=position=>restoredScroll.push(position);
const store=new GuardaStore({name:'notebook-ui',broadcast:false});
const errors=[];const ui=initNotebooks({store,showError:error=>errors.push(error.message)});
const $=id=>document.getElementById(id);
function input(type,data=null,cancelable=true){if($('nb-input').readOnly)$('nb-write').onclick();const event=new window.Event('beforeinput',{bubbles:true,cancelable});Object.assign(event,{inputType:type,data});$('nb-input').dispatchEvent(event);return event;}
const position=()=>Number($('nb-pages').textContent.split('/')[0].trim());
async function jump(value){$('nb-pages').onclick();$('nb-jump').value=String(value);await $('nb-jump').onchange({target:$('nb-jump')});}
const text=()=> $('nb-input').value;
function caret(start,end=start){$('nb-input').setSelectionRange(start,end);}
async function create(title){$('nb-title').value=title;await $('nb-create').onsubmit({preventDefault(){}});}
test('first entry creates a named notebook on page one, preserves struck ink and reopens the last page',async()=>{
 await ui.open();assert.ok($('nb-create'));assert.equal($('nb-size').value,'25');assert.equal($('nb-capacity').value,'400');await create('Pruebas');assert.equal(position(),1);
 caret(0);input('insertText','Hola mundo');await ui.flush();assert.equal(text(),'Hola mundo');
 caret(4);input('deleteContentBackward');await ui.flush();assert.equal(text(),'Hola mundo');assert.equal($('nb-ink').querySelector('s').textContent,'a');
 await $('nb-next').onclick();assert.equal(position(),2);caret(0);input('insertText','Segunda');await ui.flush();
 await $('nb-prev').onclick();assert.equal(text(),'Hola mundo');caret(10);input('insertText','!');await ui.flush();assert.equal(text(),'Hola mundo!');
 await $('nb-next').onclick();await $('nb-close').onclick();assert.equal(ui.isOpen,false);await ui.open();assert.equal(position(),2);assert.equal(text(),'Segunda');
 assert.equal((await store.allNotes()).length,1);assert.equal(errors.length,0);
});
test('over-capacity pastes leave the existing page intact and native noncancelable deletion becomes a strike',async()=>{
 caret(7);input('insertText','x'.repeat(400));assert.equal(text(),'Segunda');assert.match(errors.pop(),/espacio/);
 $('nb-input').value='Segund';$('nb-input').dispatchEvent(new window.Event('input',{bubbles:true}));await ui.flush();assert.equal(text(),'Segunda');assert.equal($('nb-ink').querySelector('s').textContent,'a');
 caret(0,3);$('nb-strike').onclick();await ui.flush();assert.equal(text(),'Segunda');assert.equal($('nb-ink').querySelectorAll('s').length,4);
});
test('writing after crossing old text keeps every old character in its original position and shows a separate writing marker',async()=>{
 caret(1);$('nb-input').dispatchEvent(new window.Event('select'));assert.equal($('nb-paper').dataset.taching,'true');assert.match($('nb-cursor-status').textContent,/Rojo/);const markerBefore=$('nb-write-caret').style.left;
 input('insertText',' nueva');await ui.flush();assert.equal(text(),'Segunda nueva');assert.equal($('nb-input').selectionStart,text().length);assert.equal($('nb-paper').dataset.taching,'false');assert.notEqual($('nb-write-caret').style.left,markerBefore);assert.equal($('nb-ink').querySelectorAll('s').length,4);
 caret(1,3);input('insertText','!');await ui.flush();assert.equal(text(),'Segunda nueva!');assert.equal($('nb-write-caret').style.left,'min(14ch, calc(100% - 2px))');
 $('nb-input').value='SegXunda nueva!';$('nb-input').dispatchEvent(new window.Event('input'));await ui.flush();assert.equal(text(),'Segunda nueva!X');
});
test('keyboard shrink and Safari viewport panning keep the entire dialog anchored; closing restores page scrolling',async()=>{
 const dialog=document.querySelector('.notebook-layer');assert.equal(document.body.style.position,'fixed');
 Object.assign(viewport,{height:350,offsetTop:140,offsetLeft:0});viewport.dispatchEvent(new Event('resize'));assert.equal(dialog.style.getPropertyValue('--notebook-height'),'350px');assert.equal(dialog.style.getPropertyValue('--notebook-top'),'140px');
 viewport.offsetTop=210;viewport.dispatchEvent(new Event('scroll'));assert.equal(dialog.style.getPropertyValue('--notebook-top'),'210px');
 $('nb-input').scrollTop=100;$('nb-input').dispatchEvent(new window.Event('scroll'));assert.equal($('nb-input').scrollTop,0);dialog.scrollTop=120;dialog.dispatchEvent(new window.Event('scroll'));assert.equal(dialog.scrollTop,0);
 Object.assign(viewport,{height:800,offsetTop:0});viewport.dispatchEvent(new Event('resize'));assert.equal(dialog.style.getPropertyValue('--notebook-height'),'800px');assert.equal(dialog.style.getPropertyValue('--notebook-top'),'0px');
 await $('nb-close').onclick();assert.notEqual(document.body.style.position,'fixed');assert.equal(restoredScroll.at(-1).top,0);await ui.open();
});
test('jumping to any page and creating a second notebook preserves each notebook position',async()=>{
 await jump(25);assert.equal($('nb-next').hasAttribute('disabled'),true);caret(0);input('insertText','Última');await ui.flush();
 await $('nb-shelf').onclick();const first=document.querySelector('[data-book]').dataset.book;$('nb-size').value='50';$('nb-capacity').value='350';await create('Otro');assert.match($('nb-count').textContent,/350/);assert.equal(position(),1);caret(0);input('insertText','Otro contenido');await ui.flush();await $('nb-shelf').onclick();
 await document.querySelector(`[data-book="${first}"]`).onclick();assert.equal(position(),25);assert.equal(text(),'Última');
 assert.equal((await store.allNotes()).length,2);await $('nb-close').onclick();store.close();
});

const waitFor=async check=>{for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,3));}throw Error('UI did not settle');};
function pointer(type,x,y,extra={}){const stage=$('nb-stage'),event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:1,clientX:x,clientY:y,button:0,isPrimary:true,...extra});stage.dispatchEvent(event);}
await test('the paper follows horizontal drags, changes pages after release, and leaves writing and vertical scrolling alone',async()=>{
 await ui.open();await jump(2);assert.equal($('nb-input').readOnly,true);
 pointer('pointerdown',260,100);pointer('pointermove',150,102);assert.match($('nb-sheet').style.transform,/-110px/);pointer('pointerup',150,102);await waitFor(()=>position()===3);await waitFor(()=>$('nb-next')!=null);
 pointer('pointerdown',100,100);pointer('pointermove',190,101);pointer('pointerup',190,101);await waitFor(()=>position()===2);
 pointer('pointerdown',100,100);pointer('pointermove',103,180);pointer('pointerup',103,180);assert.equal(position(),2);
 pointer('pointerdown',100,100);pointer('pointermove',120,100);pointer('pointerup',120,100);assert.equal(position(),2);
 pointer('pointerdown',100,100);pointer('pointermove',200,100);pointer('pointercancel',200,100);assert.equal($('nb-sheet').style.transform,'');
 $('nb-write').onclick();pointer('pointerdown',260,100);pointer('pointermove',100,100);pointer('pointerup',100,100);assert.equal(position(),2);
 $('nb-hand').onclick();await jump(1);pointer('pointerdown',100,100);pointer('pointermove',200,100);assert.match($('nb-sheet').style.transform,/18px/);pointer('pointerup',200,100);assert.equal(position(),1);
 $('nb-pages').onclick();assert.equal(document.querySelectorAll('[data-page]').length,25);await document.querySelector('[data-page="7"]').onclick();assert.equal(position(),8);assert.equal($('nb-panel').hidden,true);
 await $('nb-close').onclick();
});
await test('opening an older narrow notebook widens its lines while preserving all ink, strikes and page count',async()=>{
 const legacy=createNotebook('Anterior',{id:'legacy-notebook',capacity:250});legacy.notebook.pages=[[{char:'A',struck:true},{char:'z',struck:false}],[]];await store.putNote(legacy);
 await ui.open();await $('nb-shelf').onclick();await document.querySelector('[data-book="legacy-notebook"]').onclick();
 const saved=(await store.allNotes()).find(n=>n.id==='legacy-notebook');assert.equal(saved.notebook.columns,40);assert.equal(saved.notebook.pageCount,25);assert.deepEqual(saved.notebook.pages,legacy.notebook.pages);assert.equal(text(),'Az');assert.equal($('nb-ink').querySelector('s').textContent,'A');
 assert.match($('nb-count').textContent,/400/);await $('nb-close').onclick();store.close();
});

await test('the sheet fills the available stage and grows its line spacing instead of stopping halfway down',async()=>{
 await ui.open();const height=parseFloat($('nb-sheet').style.height);assert.ok(height>=590);assert.ok(parseFloat($('nb-writing-space').style.getPropertyValue('--ink-leading'))>=50);
 viewport.height=350;viewport.offsetTop=100;viewport.dispatchEvent(new Event('resize'));assert.equal(document.querySelector('.notebook-layer').style.getPropertyValue('--notebook-height'),'350px');assert.ok(parseFloat($('nb-sheet').style.height)>=180);
 viewport.height=800;viewport.offsetTop=0;viewport.dispatchEvent(new Event('resize'));await $('nb-close').onclick();
});
await test('selected text keeps its selection for a second irregular stroke without moving or deleting its letters',async()=>{
 await ui.open();$('nb-write').onclick();caret(0,2);$('nb-strike').onclick();await ui.flush();const first=text();assert.equal($('nb-input').selectionStart,0);assert.equal($('nb-input').selectionEnd,2);
 assert.ok($('nb-strokes').querySelector('path'));$('nb-strike').onclick();await ui.flush();assert.equal(text(),first);assert.ok($('nb-strokes').querySelector('.nb-stroke-heavy'));
 assert.ok($('nb-ink').querySelector('s[data-passes="2"]'));await $('nb-close').onclick();store.close();
});

await test('the faint warning becomes a fixed margin hyphen while text, positions and stored character count stay intact',async()=>{
 await ui.open();await $('nb-shelf').onclick();$('nb-new').onclick();await create('Márgenes');
 caret(0);input('insertText','ñ'.repeat(39));await ui.flush();assert.ok($('nb-wrap-markers').querySelector('.nb-wrap-warning[data-row="0"]'));assert.equal($('nb-wrap-markers').querySelector('.nb-wrap-fixed'),null);
 input('insertText','o');await ui.flush();assert.ok($('nb-wrap-markers').querySelector('.nb-wrap-warning'));
 input('insertText','a');await ui.flush();assert.equal(text(),'ñ'.repeat(39)+'oa');assert.equal($('nb-ink').textContent,text());assert.ok($('nb-wrap-markers').querySelector('.nb-wrap-fixed[data-row="0"]'));assert.equal($('nb-wrap-markers').querySelector('.nb-wrap-warning'),null);
 const saved=(await store.allNotes()).find(n=>n.title==='Márgenes');assert.equal(saved.notebook.pages[0].length,41);assert.equal(saved.body,text());
 await $('nb-close').onclick();await ui.open();assert.ok($('nb-wrap-markers').querySelector('.nb-wrap-fixed[data-row="0"]'));await $('nb-close').onclick();store.close();
});
