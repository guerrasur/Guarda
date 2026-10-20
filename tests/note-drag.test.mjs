import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {bindNoteDrag} from '../src/note-drag.js';
function setup(){
 const {document,window}=parseHTML('<html><body><header class="header"></header><div id="area"><div class="notes-grid"><article data-note="a" draggable="true"><h3>A</h3><button>Fijar</button></article><article data-note="b">B</article></div><div class="notes-grid"><article data-note="p">Fijada</article></div></div></body></html>');
 const area=document.getElementById('area'),a=area.querySelector('[data-note=a]'),b=area.querySelector('[data-note=b]'),p=area.querySelector('[data-note=p]');
 a.getBoundingClientRect=()=>({left:20,top:200,width:160,height:120});b.getBoundingClientRect=()=>({left:200,top:200,width:160,height:120});document.querySelector('header').getBoundingClientRect=()=>({bottom:100});let hit=b;
 document.elementFromPoint=()=>hit;const timers=new Map(),frames=new Map(),moves=[],deleted=[],busy=[],scroll=[];let sequence=0;
 const env={document,window:{innerHeight:800,scrollBy:(x,y)=>scroll.push(y)},setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)};
 bindNoteDrag(area,{env,onMove:async(...args)=>moves.push(args),onTrash:async id=>deleted.push(id),onBusyChange:v=>busy.push(v),onError:e=>{throw e;}});
 function event(target,type,{x=40,y=240,touches=1}={}){const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{touches:type==='touchend'?[]:Array.from({length:touches},(_,identifier)=>({identifier,clientX:x,clientY:y})),changedTouches:[{identifier:0,clientX:x,clientY:y}],clientX:x,clientY:y});target.dispatchEvent(e);return e;}
 const bin=document.querySelector('.drag-trash');bin.getBoundingClientRect=()=>({left:170,right:230,top:720,bottom:780});
 return {document,area,a,b,p,moves,deleted,bin,busy,scroll,event,hit:card=>hit=card,hold:()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}},frame:()=>{for(const [id,fn] of [...frames]){frames.delete(id);fn();}}};
}
test('short tap opens normally; moving before the hold preserves scrolling and never reorders',()=>{
 const f=setup();f.event(f.a,'touchstart');assert.equal(f.a.getAttribute('draggable'),'false');assert.equal(f.event(f.document,'touchend').defaultPrevented,false);f.hold();assert.equal(f.a.getAttribute('draggable'),'true');assert.equal(f.moves.length,0);
 f.event(f.a,'touchstart');assert.equal(f.event(f.document,'touchmove',{y:280}).defaultPrevented,false);f.hold();assert.equal(f.document.querySelector('.drag-ghost'),null);f.event(f.document,'touchend');assert.equal(f.moves.length,0);
});
test('long press lifts the card, blocks scrolling, drops after target and suppresses opening',async()=>{
 const f=setup();let opened=0;f.area.addEventListener('click',()=>opened++);f.event(f.a.querySelector('h3'),'touchstart');f.hold();assert.ok(f.document.querySelector('.drag-ghost'));assert.equal(f.a.classList.contains('drag-source'),true);
 assert.equal(f.event(f.document,'touchmove',{x:230,y:310}).defaultPrevented,true);assert.ok(f.b.classList.contains('drop-after'));assert.equal(f.event(f.document,'touchend',{x:230,y:310}).defaultPrevented,true);await Promise.resolve();await Promise.resolve();
 assert.deepEqual(f.moves,[['a','b',true]]);assert.equal(f.document.querySelector('.drag-ghost'),null);assert.equal(f.a.classList.contains('drag-source'),false);assert.equal(f.busy.at(-1),false);
 const click=f.event(f.a,'click');assert.equal(click.defaultPrevented,true);assert.equal(opened,0);
});
test('cancel, multitouch and dropping in another section leave the order intact',async()=>{
 for(const action of ['cancel','multitouch','section']){const f=setup();f.event(f.a,'touchstart');f.hold();if(action==='cancel')f.event(f.document,'touchcancel');if(action==='multitouch')f.event(f.document,'touchmove',{touches:2});if(action==='section'){f.hit(f.p);f.event(f.document,'touchmove',{x:200,y:300});f.event(f.document,'touchend');}await Promise.resolve();assert.deepEqual(f.moves,[]);assert.equal(f.document.querySelector('.drag-ghost'),null);assert.equal(f.busy.at(-1),false);}
});
test('buttons stay interactive and edge dragging scrolls the board',()=>{
 const f=setup();f.event(f.a.querySelector('button'),'touchstart');f.hold();assert.equal(f.document.querySelector('.drag-ghost'),null);
 f.event(f.a,'touchstart');f.hold();f.event(f.document,'touchmove',{x:330,y:780});f.frame();assert.ok(f.scroll.some(v=>v>0));f.event(f.document,'touchcancel');
});
test('second finger before the long-press threshold cancels the pending drag',()=>{
 const f=setup();f.event(f.a,'touchstart');f.event(f.document,'touchstart',{touches:2});f.hold();assert.equal(f.document.querySelector('.drag-ghost'),null);assert.equal(f.a.getAttribute('draggable'),'true');
});
test('touch release uses the final hit position instead of a stale drop target',async()=>{
 const f=setup();f.event(f.a,'touchstart');f.hold();f.event(f.document,'touchmove',{x:230,y:310});f.hit(f.p);f.event(f.document,'touchend',{x:230,y:500});await Promise.resolve();assert.deepEqual(f.moves,[]);
});
test('a redraw removing the original card cancels the floating drag and unlocks updates',()=>{
 const f=setup();f.event(f.a,'touchstart');f.hold();f.a.remove();f.frame();assert.equal(f.document.querySelector('.drag-ghost'),null);assert.equal(f.busy.at(-1),false);
});
test('backgrounding during native mouse drag cleans up source styling and update lock',()=>{
 const f=setup();f.event(f.a,'dragstart');assert.equal(f.busy.at(-1),true);Object.defineProperty(f.document,'hidden',{value:true});f.event(f.document,'visibilitychange');assert.equal(f.a.classList.contains('drag-source'),false);assert.equal(f.busy.at(-1),false);
});

test('touch trash drop highlights target, deletes once and clears feedback',async()=>{
 const f=setup();assert.equal(f.bin.hidden,true);f.event(f.a,'touchstart');f.hold();assert.equal(f.bin.hidden,false);
 f.event(f.document,'touchmove',{x:200,y:750});assert.ok(f.bin.classList.contains('drag-trash-active'));assert.ok(f.document.querySelector('.drag-ghost-trash'));
 f.event(f.document,'touchend',{x:200,y:750});await Promise.resolve();assert.deepEqual(f.deleted,['a']);assert.deepEqual(f.moves,[]);assert.equal(f.bin.hidden,true);
});
test('mouse drop outside notes reaches trash, while cancellation never deletes',async()=>{
 const f=setup();f.event(f.a,'dragstart');f.event(f.document,'dragover',{x:200,y:750});assert.ok(f.bin.classList.contains('drag-trash-active'));f.event(f.document,'drop',{x:200,y:750});await Promise.resolve();assert.deepEqual(f.deleted,['a']);assert.equal(f.bin.hidden,true);
 const g=setup();g.event(g.a,'touchstart');g.hold();g.event(g.document,'touchmove',{x:200,y:750});g.event(g.document,'touchcancel');assert.deepEqual(g.deleted,[]);assert.equal(g.bin.hidden,true);
});
test('notes already in trash never expose the delete target',()=>{
 const f=setup();f.a.dataset.deleted='true';f.event(f.a,'touchstart');f.hold();assert.equal(f.bin.hidden,true);f.event(f.document,'touchend',{x:200,y:750});assert.deepEqual(f.deleted,[]);
});
