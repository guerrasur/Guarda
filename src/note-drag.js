import { icon } from './icons.js';
// Touch Events let a normal swipe scroll, then prevent scrolling only after
// the hold is recognised (including Safari, where native HTML drag is limited).
export function bindNoteDrag(area,{onMove,onTrash,onError=console.error,onBusyChange=()=>{},env=globalThis}={}){
 const {document,window}=env;
 let gesture=null,timer=null,ghost=null,frame=null,target=null,after=false,native=null,committing=false,suppressUntil=0;
 const bin=document.createElement('div');bin.className='drag-trash';bin.hidden=true;bin.setAttribute('role','status');bin.innerHTML=icon('trash')+'<span>Soltá para eliminar</span>';document.body.append(bin);
 let overTrash=false;
 function showBin(source){bin.hidden=!onTrash||source.dataset.deleted==='true';}
 function trashHit(x,y){const r=bin.getBoundingClientRect();return !bin.hidden&&x>=r.left-16&&x<=r.right+16&&y>=r.top-16&&y<=r.bottom+16;}
 function markTrash(active){overTrash=active;bin.classList.toggle('drag-trash-active',active);ghost?.classList.toggle('drag-ghost-trash',active);}
 const cardOf=element=>{const card=element?.closest?.('[data-note]');return card&&area.contains(card)?card:null;};
 const interactive=element=>element?.closest?.('button,input,audio,video,a,label,[contenteditable=true]');
 const pointOf=event=>[...(event.touches||[]),...(event.changedTouches||[])].find(t=>t.identifier===gesture?.id);
 const cancelTimer=()=>{env.clearTimeout(timer);timer=null;};
 function clearTarget(){target?.classList.remove('drop-before','drop-after');target=null;}
 function locate(x,y,source){
  clearTarget();markTrash(trashHit(x,y));if(overTrash)return;const card=cardOf(document.elementFromPoint(x,y));
  if(!source.isConnected||!card||card===source||card.parentElement!==source.parentElement)return;
  target=card;const rect=card.getBoundingClientRect();after=y>rect.top+rect.height/2;
  card.classList.add(after?'drop-after':'drop-before');
 }
 function track(){
  if(!gesture?.active)return;
  const {x,y,card,dx,dy}=gesture;
  if(!card.isConnected){cancel();return;}
  ghost.style.transform=`translate(${x-dx}px,${y-dy}px)`;
  const top=(document.querySelector('.header')?.getBoundingClientRect().bottom||0)+24;
  const bottom=window.innerHeight-100;
  const speed=y<top?-Math.min(16,(top-y)/3):y>bottom?Math.min(16,(y-bottom)/3):0;
  if(speed&&!overTrash)window.scrollBy(0,speed);
  locate(x,y,card);frame=env.requestAnimationFrame(track);
 }
 function cleanup(){
  cancelTimer();if(frame!==null)env.cancelAnimationFrame(frame);frame=null;ghost?.remove();ghost=null;
  if(gesture){gesture.card.classList.remove('drag-source');if(gesture.draggable===null)gesture.card.removeAttribute('draggable');else gesture.card.setAttribute('draggable',gesture.draggable);}
  clearTarget();markTrash(false);bin.hidden=true;gesture=null;
  document.body.classList.remove('note-dragging');
 }
 function cancel(){
  if(gesture?.active||native)suppressUntil=Date.now()+800;
  cleanup();native?.classList.remove('drag-source');native=null;
  if(!committing)onBusyChange(false);
 }
 async function commit(source,destination,insertAfter,remove=false){
  committing=true;onBusyChange(true);
  try{if(remove&&source.isConnected){await onTrash(source.dataset.note);return;}if(source.isConnected&&destination?.isConnected&&destination!==source&&destination.parentElement===source.parentElement)await onMove(source.dataset.note,destination.dataset.note,insertAfter);}
  catch(error){onError(error);}finally{committing=false;onBusyChange(false);}
 }
 area.addEventListener('touchstart',event=>{
  if(event.touches.length!==1){if(gesture)cancel();return;}
  if(gesture||committing)return;
  const card=cardOf(event.target);if(!card||interactive(event.target))return;
  const p=event.touches[0],rect=card.getBoundingClientRect();
  gesture={id:p.identifier,card,x:p.clientX,y:p.clientY,startX:p.clientX,startY:p.clientY,dx:p.clientX-rect.left,dy:p.clientY-rect.top,draggable:card.getAttribute('draggable'),active:false};
  // Suppress Safari native image/card dragging while this touch gesture owns it.
  card.setAttribute('draggable','false');
  timer=env.setTimeout(()=>{
   if(!gesture||!card.isConnected){cleanup();return;}
   gesture.active=true;showBin(card);onBusyChange(true);document.body.classList.add('note-dragging');card.classList.add('drag-source');
   ghost=card.cloneNode(true);ghost.removeAttribute('data-note');ghost.removeAttribute('draggable');ghost.removeAttribute('tabindex');ghost.setAttribute('aria-hidden','true');ghost.classList.remove('drag-source');ghost.classList.add('drag-ghost');
   ghost.style.width=`${rect.width}px`;ghost.style.height=`${rect.height}px`;document.body.append(ghost);track();
  },450);
 },{passive:true});
 document.addEventListener('touchstart',event=>{if(gesture&&event.touches.length!==1)cancel();},{passive:true});
 document.addEventListener('touchmove',event=>{
  if(!gesture)return;
  if(event.touches.length!==1){cancel();return;}
  const p=pointOf(event);if(!p)return;
  gesture.x=p.clientX;gesture.y=p.clientY;
  if(gesture.active){event.preventDefault();locate(p.clientX,p.clientY,gesture.card);}
  else if(Math.hypot(p.clientX-gesture.startX,p.clientY-gesture.startY)>10)cleanup();
 },{passive:false});
 document.addEventListener('touchend',event=>{
  if(!gesture)return;
  const p=[...(event.changedTouches||[])].find(t=>t.identifier===gesture.id);if(!p)return;
  const {active,card}=gesture;
  if(active)locate(p.clientX,p.clientY,card);
  if(active){event.preventDefault();suppressUntil=Date.now()+800;const destination=target,insertAfter=after,remove=overTrash;cleanup();commit(card,destination,insertAfter,remove);}
  else cleanup();
 },{passive:false});
 document.addEventListener('touchcancel',()=>{if(gesture)cancel();});
 area.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 area.addEventListener('contextmenu',event=>{if(cardOf(event.target)&&!interactive(event.target))event.preventDefault();});
 area.addEventListener('dragstart',event=>{
  const card=cardOf(event.target);if(!card||interactive(event.target)||gesture?.active||committing){event.preventDefault();return;}
  cleanup();native=card;showBin(card);document.body.classList.add('note-dragging');native.classList.add('drag-source');onBusyChange(true);event.dataTransfer?.setData('text/plain',card.dataset.note);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
 });
 document.addEventListener('dragover',event=>{if(!native)return;event.preventDefault();locate(event.clientX,event.clientY,native);});
 document.addEventListener('drop',event=>{
  if(!native)return;event.preventDefault();locate(event.clientX,event.clientY,native);const source=native,destination=target,insertAfter=after,remove=overTrash;native.classList.remove('drag-source');native=null;cleanup();commit(source,destination,insertAfter,remove);
 });
 area.addEventListener('dragend',()=>{native?.classList.remove('drag-source');native=null;cleanup();if(!committing)onBusyChange(false);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
 window.addEventListener?.('blur',cancel);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(gesture||native)){event.preventDefault();cancel();}});
 return {cancel};
}
