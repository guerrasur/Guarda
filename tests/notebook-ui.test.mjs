import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { indexedDB } from 'fake-indexeddb';
import { GuardaStore } from '../src/storage.js';
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
const store=new GuardaStore({name:'notebook-ui',broadcast:false});
const errors=[];const ui=initNotebooks({store,showError:error=>errors.push(error.message)});
const $=id=>document.getElementById(id);
function input(type,data=null,cancelable=true){const event=new window.Event('beforeinput',{bubbles:true,cancelable});Object.assign(event,{inputType:type,data});$('nb-input').dispatchEvent(event);return event;}
const text=()=> $('nb-input').value;
function caret(start,end=start){$('nb-input').setSelectionRange(start,end);}
async function create(title){$('nb-title').value=title;await $('nb-create').onsubmit({preventDefault(){}});}
test('first entry creates a named notebook on page one, preserves struck ink and reopens the last page',async()=>{
 await ui.open();assert.ok($('nb-create'));assert.equal($('nb-size').value,'25');assert.equal($('nb-capacity').value,'250');await create('Pruebas');assert.equal($('nb-jump').value,'1');
 caret(0);input('insertText','Hola mundo');await ui.flush();assert.equal(text(),'Hola mundo');
 caret(4);input('deleteContentBackward');await ui.flush();assert.equal(text(),'Hola mundo');assert.equal($('nb-ink').querySelector('s').textContent,'a');
 await $('nb-next').onclick();assert.equal($('nb-jump').value,'2');caret(0);input('insertText','Segunda');await ui.flush();
 await $('nb-prev').onclick();assert.equal(text(),'Hola mundo');caret(10);input('insertText','!');await ui.flush();assert.equal(text(),'Hola mundo!');
 await $('nb-next').onclick();await $('nb-close').onclick();assert.equal(ui.isOpen,false);await ui.open();assert.equal($('nb-jump').value,'2');assert.equal(text(),'Segunda');
 assert.equal((await store.allNotes()).length,1);assert.equal(errors.length,0);
});
test('over-capacity pastes leave the existing page intact and native noncancelable deletion becomes a strike',async()=>{
 caret(7);input('insertText','x'.repeat(250));assert.equal(text(),'Segunda');assert.match(errors.pop(),/espacio/);
 $('nb-input').value='Segund';$('nb-input').dispatchEvent(new window.Event('input',{bubbles:true}));await ui.flush();assert.equal(text(),'Segunda');assert.equal($('nb-ink').querySelector('s').textContent,'a');
 caret(0,3);$('nb-strike').onclick();await ui.flush();assert.equal(text(),'Segunda');assert.equal($('nb-ink').querySelectorAll('s').length,4);
});
test('jumping to any page and creating a second notebook preserves each notebook position',async()=>{
 $('nb-jump').value='25';await $('nb-jump').onchange({target:$('nb-jump')});assert.equal($('nb-next').hasAttribute('disabled'),true);caret(0);input('insertText','Última');await ui.flush();
 await $('nb-shelf').onclick();const first=document.querySelector('[data-book]').dataset.book;$('nb-size').value='50';$('nb-capacity').value='200';await create('Otro');assert.match($('nb-count').textContent,/200/);assert.equal($('nb-jump').value,'1');caret(0);input('insertText','Otro contenido');await ui.flush();await $('nb-shelf').onclick();
 await document.querySelector(`[data-book="${first}"]`).onclick();assert.equal($('nb-jump').value,'25');assert.equal(text(),'Última');
 assert.equal((await store.allNotes()).length,2);await $('nb-close').onclick();store.close();
});
