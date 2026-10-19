// Touch Events let a normal swipe scroll, then prevent scrolling only after
// the hold is recognised (including Safari, where native HTML drag is limited).
export function bindNoteDrag(area,{onMove,onError=console.error,onBusyChange=()=>{},env=globalThis}={}){
 const {document,window}=env;
 let gesture=null,timer=null,ghost=null,frame=null,target=null,after=false,native=null,committing=false,suppressUntil=0;
 const cardOf=element=>{const card=element?.closest?.('[data-note]');return card&&area.contains(card)?card:null;};
 const interactive=element=>element?.closest?.('button,input,audio,video,a,label,[contenteditable=true]');
 const pointOf=event=>[...(event.touches||[]),...(event.changedTouches||[])].find(t=>t.identifier===gesture?.id);
 const cancelTimer=()=>{env.clearTimeout(timer);timer=null;};
 function clearTarget(){target?.classList.remove('drop-before','drop-after');target=null;}
 function locate(x,y,source){
  clearTarget();const card=cardOf(document.elementFromPoint(x,y));
  if(!card||card===source||card.parentElement!==source.parentElement)return;
  target=card;const rect=card.getBoundingClientRect();after=y>rect.top+rect.height/2;
  card.classList.add(after?'drop-after':'drop-before');
 }
 function track(){
  if(!gesture?.active)return;
  const {x,y,card,dx,dy}=gesture;ghost.style.transform=`translate(${x-dx}px,${y-dy}px)`;
  const top=(document.querySelector('.header')?.getBoundingClientRect().bottom||0)+24;
  const bottom=window.innerHeight-100;
  const speed=y<top?-Math.min(16,(top-y)/3):y>bottom?Math.min(16,(y-bottom)/3):0;
  if(speed)window.scrollBy(0,speed);
  locate(x,y,card);frame=env.requestAnimationFrame(track);
 }
 function cleanup(){
  cancelTimer();if(frame!==null)env.cancelAnimationFrame(frame);frame=null;ghost?.remove();ghost=null;
  gesture?.card.classList.remove('drag-source');clearTarget();gesture=null;
  document.body.classList.remove('note-dragging');
 }
 async function commit(source,destination,insertAfter){
  committing=true;onBusyChange(true);
  try{if(destination&&destination!==source)await onMove(source.dataset.note,destination.dataset.note,insertAfter);}
  catch(error){onError(error);}finally{committing=false;onBusyChange(false);}
 }
 area.addEventListener('touchstart',event=>{
  if(gesture||committing||event.touches.length!==1)return;
  const card=cardOf(event.target);if(!card||interactive(event.target))return;
  const p=event.touches[0],rect=card.getBoundingClientRect();
  gesture={id:p.identifier,card,x:p.clientX,y:p.clientY,startX:p.clientX,startY:p.clientY,dx:p.clientX-rect.left,dy:p.clientY-rect.top,active:false};
  timer=env.setTimeout(()=>{
   if(!gesture||!card.isConnected){cleanup();return;}
   gesture.active=true;onBusyChange(true);document.body.classList.add('note-dragging');card.classList.add('drag-source');
   ghost=card.cloneNode(true);ghost.removeAttribute('data-note');ghost.removeAttribute('draggable');ghost.removeAttribute('tabindex');ghost.setAttribute('aria-hidden','true');ghost.classList.remove('drag-source');ghost.classList.add('drag-ghost');
   ghost.style.width=`${rect.width}px`;ghost.style.height=`${rect.height}px`;document.body.append(ghost);track();
  },450);
 },{passive:true});
 document.addEventListener('touchmove',event=>{
  if(!gesture)return;
  if(event.touches.length!==1){const active=gesture.active;cleanup();if(active){suppressUntil=Date.now()+800;onBusyChange(false);}return;}
  const p=pointOf(event);if(!p)return;
  gesture.x=p.clientX;gesture.y=p.clientY;
  if(gesture.active){event.preventDefault();locate(p.clientX,p.clientY,gesture.card);}
  else if(Math.hypot(p.clientX-gesture.startX,p.clientY-gesture.startY)>10)cleanup();
 },{passive:false});
 document.addEventListener('touchend',event=>{
  if(!gesture||!pointOf(event))return;
  const {active,card}=gesture;
  if(active){event.preventDefault();suppressUntil=Date.now()+800;const destination=target,insertAfter=after;cleanup();commit(card,destination,insertAfter);}
  else cleanup();
 },{passive:false});
 document.addEventListener('touchcancel',()=>{if(!gesture)return;const active=gesture.active;cleanup();if(active){suppressUntil=Date.now()+800;onBusyChange(false);}});
 area.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 area.addEventListener('contextmenu',event=>{if(cardOf(event.target)&&!interactive(event.target))event.preventDefault();});
 area.addEventListener('dragstart',event=>{
  const card=cardOf(event.target);if(!card||interactive(event.target)||gesture?.active||committing){event.preventDefault();return;}
  cleanup();native=card;native.classList.add('drag-source');onBusyChange(true);event.dataTransfer?.setData('text/plain',card.dataset.note);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
 });
 area.addEventListener('dragover',event=>{if(!native)return;event.preventDefault();locate(event.clientX,event.clientY,native);});
 area.addEventListener('drop',event=>{
  if(!native)return;event.preventDefault();const source=native,destination=target,insertAfter=after;native.classList.remove('drag-source');native=null;clearTarget();commit(source,destination,insertAfter);
 });
 area.addEventListener('dragend',()=>{native?.classList.remove('drag-source');native=null;clearTarget();if(!committing)onBusyChange(false);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&gesture){cleanup();onBusyChange(false);}});
 return {cancel:()=>{cleanup();onBusyChange(false);}};
}
