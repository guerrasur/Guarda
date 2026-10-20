import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { animate, animateBoard, animateEditor, captureBoard, cancelMotion, noteElement } from '../src/motion.js';

const rect = (left=10,top=10) => ({left,top,right:left+200,bottom:top+100,width:200,height:100});
function fixture({reduced=false,hidden=false}={}) {
  return {innerWidth:1000,innerHeight:800,document:{hidden,body:{classList:{contains:()=>false}}},matchMedia:()=>({matches:reduced})};
}
function card(id,position=rect()) {
  const calls=[];
  return {dataset:{note:id},calls,getBoundingClientRect:()=>position,animate(frames,options){
    let finish,reject;
    const animation={finished:new Promise((resolve,rejected)=>{finish=resolve;reject=rejected;}),cancel(){animation.cancelled=true;reject(Error('cancelled'));},finish(){finish();}};
    calls.push({frames,options,animation});return animation;
  }};
}
test('reduced motion, background tabs and missing animation API never delay an action',async()=>{
  const element=card('one');
  await animate(element,[{opacity:0},{opacity:1}],{},fixture({reduced:true}));
  await animate(element,[],{},fixture({hidden:true}));
  await animate({},[],{},fixture());
  assert.equal(element.calls.length,0);
});
test('reordering uses current card positions and only animates visible notes',async()=>{
  const old=[card('a'),card('b',rect(250,10))];const area={querySelectorAll:()=>old};const before=captureBoard(area,fixture());
  const current=[card('b'),card('a',rect(250,10)),card('offscreen',rect(10,2000))];area.querySelectorAll=()=>current;
  animateBoard(area,before,fixture());
  assert.match(current[0].calls[0].frames[0].transform,/translate\(240px,0px\)/);
  assert.match(current[1].calls[0].frames[0].transform,/translate\(-240px,0px\)/);
  assert.equal(current[2].calls.length,0);
  for(const c of current)cancelMotion(c);
  await Promise.resolve();
});
test('rapid transitions cancel their predecessor and cancellation resolves closing safely',async()=>{
  const element=card('editor');const first=animateEditor(element,rect(20,20),false,fixture());
  const closing=animateEditor(element,rect(400,400),true,fixture());
  assert.equal(element.calls[0].animation.cancelled,true);
  element.calls[1].animation.finish();await Promise.all([first,closing]);
});
test('full-screen mobile editor never transforms the ancestor of its fixed toolbar',async()=>{
  const element=card('editor'),env={...fixture(),innerWidth:390};
  const pending=animateEditor(element,rect(),false,env);
  assert.ok(element.calls[0].frames.every(frame=>!('transform' in frame)));
  element.calls[0].animation.finish();await pending;
});
test('board motion stays bounded on large collections and imported IDs are selector-safe',async()=>{
  const cards=Array.from({length:100},(_,i)=>card(i===0?'id"[unsafe]':String(i)));
  const area={querySelectorAll:()=>cards};animateBoard(area,new Map(),fixture());
  assert.equal(cards.filter(c=>c.calls.length).length,40);
  assert.equal(noteElement(area,'id"[unsafe]'),cards[0]);
  for(const c of cards)cancelMotion(c);
  await Promise.resolve();
});
test('departing notes are inert, do not duplicate IDs and clean up after the animation',async()=>{
  const {document,window}=parseHTML('<html><body><main><article data-note="a"><button id="control">Archivar</button></article></main></body></html>');
  let finish;window.HTMLElement.prototype.animate=function(){return {finished:new Promise(resolve=>finish=resolve),cancel(){finish();}};};
  const area=document.querySelector('main'),source=area.firstElementChild;source.getBoundingClientRect=()=>rect();
  const env={...fixture(),document};const before=captureBoard(area,env);source.remove();animateBoard(area,before,env);
  const ghost=document.querySelector('.motion-departure');assert.ok(ghost);assert.equal(ghost.inert,true);assert.equal(ghost.getAttribute('aria-hidden'),'true');assert.equal(document.querySelectorAll('[data-note],[id]').length,0);
  finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelector('.motion-departure'),null);
});
