import { createNotebook, editPage, isNotebook, pageText, pageSpace, notebookFormat, strikeRuns, inkPasses, lineContinuations } from './notebook.js';
import { DraftRecovery } from './draft-recovery.js';
import { icon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initNotebooks({store, showError, onClose, onPending}) {
 const layer = document.createElement('dialog'); layer.className='notebook-layer'; layer.setAttribute('aria-label','Modo cuaderno'); document.body.append(layer);
 let storage; try { storage=globalThis.localStorage; } catch {}
 const recovery=new DraftRecovery(storage);
 let book=null, pageIndex=0, queue=Promise.resolve(), busy=false, composition=false, previousFocus=null, observer=null, scrollLock=null, interaction='read', turning=false;
 const $=id=>layer.querySelector(`#${id}`);
 const page=()=>book.notebook.pages[pageIndex] || [];
 const format=()=>notebookFormat(book);
 function lockScroll() {
  if(scrollLock)return;
  scrollLock={body:document.body.style.cssText,root:document.documentElement.style.overflow,x:globalThis.scrollX||0,y:globalThis.scrollY||0};
  Object.assign(document.body.style,{position:'fixed',top:`-${scrollLock.y}px`,left:'0',width:'100%',overflow:'hidden'});
  document.documentElement.style.overflow='hidden';
 }
 function unlockScroll() {
  if(!scrollLock)return;const previous=scrollLock;scrollLock=null;
  document.body.style.cssText=previous.body;document.documentElement.style.overflow=previous.root;
  globalThis.scrollTo?.({left:previous.x,top:previous.y,behavior:'instant'});
 }
 function syncViewport() {
  if(!layer.open)return;
  const viewport=globalThis.visualViewport;
  // Safari pans the visual viewport as well as shrinking it for the keyboard.
  // A fixed surface must follow BOTH offsets, not just the new height.
  layer.style.setProperty('--notebook-top',`${viewport?.offsetTop||0}px`);
  layer.style.setProperty('--notebook-left',`${viewport?.offsetLeft||0}px`);
  layer.style.setProperty('--notebook-height',viewport?`${viewport.height}px`:'100dvh');
  layer.style.setProperty('--notebook-width',viewport?`${viewport.width}px`:'100vw');
  layer.scrollTop=0;layer.scrollLeft=0;
  const input=$('nb-input');if(input){input.scrollTop=0;input.scrollLeft=0;}
  fit();
 }
 function trackCaret() {
  const input=$('nb-input'),paper=$('nb-paper');if(!input||!book)return;
  const {columns,rows,capacity}=format(),used=pageSpace(page(),format());
  const marker=$('nb-write-caret');
  marker.style.left=`min(${used===capacity?columns:used%columns}ch, calc(100% - 2px))`;
  marker.style.top=`calc(${Math.min(rows-1,Math.floor(used/columns))} * var(--ink-leading, 1.5em) + var(--cursor-inset, 0px))`;
  const range=selection(),taching=range.start!==page().length||range.end!==range.start;
  paper.dataset.taching=String(taching);
  const warning=lineContinuations(page(),format()).warning;
  $('nb-cursor-status').textContent=(taching?'Rojo: tachado · Verde: seguís acá':'Verde: seguís escribiendo acá')+(interaction==='write'&&warning!==null?' · Fin de renglón próximo':'');
 }
 function setTool(tool,focus=false) {
  interaction=tool;const input=$('nb-input');if(!input)return;
  $('nb-paper').dataset.tool=tool;input.readOnly=tool==='read';
  for(const [id,value] of [['nb-write','write'],['nb-hand','read'],['nb-strike','strike']])$(id)?.setAttribute('aria-pressed',String(tool===value));
  if(tool==='read')input.blur();else if(focus){if(tool==='write'){const end=input.value.length;input.setSelectionRange(end,end);}input.focus({preventScroll:true});}
  trackCaret();
 }
 function report(error) { const banner=$('nb-error');if(banner){banner.textContent=error.message;banner.hidden=false;}showError(error); }
 function remember() { try { storage?.setItem('guarda-notebook-position',JSON.stringify({id:book.id,page:pageIndex})); storage?.setItem('guarda-notebook-page:'+book.id,String(pageIndex)); } catch(error) { report(error); } }
 function save() {
  book.updatedAt=Date.now(); book.body=book.notebook.pages.map(pageText).join('\n\n');
  const snapshot=structuredClone(book); let journal;
  try { journal=recovery.capture(snapshot); } catch(error) { report(error); }
  onPending?.();
  queue=queue.catch(()=>{}).then(async()=>{
   await store.putNote(snapshot); if(journal)recovery.acknowledge(snapshot.id,journal);
   if($('nb-status')){$('nb-status').innerHTML=icon('check');$('nb-status').setAttribute('aria-label','Guardado local');}
  }).catch(error=>{if($('nb-status'))$('nb-status').textContent='Error al guardar';report(error);throw error;});
  // Keep failures observable by flush, without an unhandled rejection while typing.
  queue.catch(()=>{}); if($('nb-status'))$('nb-status').innerHTML=icon('clock');
  return queue;
 }
 async function close() { $('nb-input')?.blur();await queue; layer.close(); observer?.disconnect(); book=null;unlockScroll();onClose?.(); previousFocus?.focus?.({preventScroll:true}); }
 function bindClose() { $('nb-close').onclick=()=>close().catch(report); }
 function shell(content) { observer?.disconnect(); layer.innerHTML=`<div class="notebook-app">${content}<p class="notebook-error" id="nb-error" role="alert" hidden></p></div>`; bindClose(); }
 async function shelf(forceCreate=false) {
  await queue; book=null;
  const books=(await store.allNotes()).filter(n=>isNotebook(n)&&!n.deletedAt);
  shell(`<header class="notebook-top"><button class="icon-button" id="nb-close" aria-label="Volver a Guarda">${icon('back')}</button><strong>Cuadernos</strong><button class="icon-button" id="nb-new" aria-label="Nuevo cuaderno">${icon('plus')}</button></header><div class="notebook-shelf"><form id="nb-create"><label for="nb-title">Título del nuevo cuaderno</label><input id="nb-title" maxlength="120" placeholder="Mi cuaderno" required autocomplete="off"><label for="nb-size">Tamaño del cuaderno</label><select id="nb-size"><option value="25">Pequeño · 25 hojas</option><option value="50">Mediano · 50 hojas</option><option value="100">Grande · 100 hojas</option></select><label for="nb-capacity">Capacidad de cada hoja</label><select id="nb-capacity"><option value="400">400 · Renglones amplios</option><option value="350">350 · Renglones medianos</option></select><button class="text-button" type="submit">Crear cuaderno</button></form><div class="notebook-books">${books.map(n=>`<button class="notebook-cover" data-book="${esc(n.id)}">${icon('book')}<strong>${esc(n.title)}</strong><span>${n.notebook.pageCount} hojas · ${notebookFormat(n).capacity} caracteres por hoja</span></button>`).join('')}</div></div>`);
  $('nb-create').hidden=books.length>0&&!forceCreate;$('nb-new').onclick=()=>{$('nb-create').hidden=!$('nb-create').hidden;if(!$('nb-create').hidden)$('nb-title').focus();};
  $('nb-create').onsubmit=async event=>{event.preventDefault();if(busy)return;const title=$('nb-title').value.trim();if(!title){$('nb-title').focus();return;}busy=true;try{book=createNotebook(title,{pageCount:Number($('nb-size').value),capacity:Number($('nb-capacity').value)});pageIndex=0;interaction='write';await save();remember();render();}catch(error){report(error);}finally{busy=false;}};
  for(const button of layer.querySelectorAll('[data-book]'))button.onclick=()=>openBook(button.dataset.book).catch(report);
  if(forceCreate)$('nb-title').focus();
 }
 async function openBook(id) {
  await queue; const found=(await store.allNotes()).find(n=>n.id===id&&isNotebook(n)&&!n.deletedAt); if(!found){await shelf();return;}
  book=structuredClone(found);interaction='read';if(book.notebook.columns<35){book.notebook.columns=40;await save();}let position;try{position=JSON.parse(storage?.getItem('guarda-notebook-position'));}catch{}
  let savedPage;try{savedPage=storage?.getItem('guarda-notebook-page:'+id);}catch{}
  pageIndex=Math.max(0,Math.min(book.notebook.pageCount-1,Number(savedPage??(position?.id===id?position.page:0))||0));remember();render();
 }
 function fit() {
  const space=$('nb-writing-space'); if(!space||!book)return;
  const r=space.getBoundingClientRect();
  const paper=$('nb-paper'),fontSize=parseFloat(globalThis.getComputedStyle?.(paper).fontSize)||12;
  const widthPerEm=globalThis.getComputedStyle?paper.getBoundingClientRect().width/fontSize:format().columns*.6021;
  const size=Math.max(1,Math.min(24,(r.width-4)/widthPerEm));
  const stage=$('nb-stage'),sheet=$('nb-sheet');
  if(stage&&sheet){const height=stage.clientHeight||stage.getBoundingClientRect().height;sheet.style.height=`${Math.max(format().rows*size*1.5+168,height-4)}px`;}
  const leading=Math.max(size*1.5,space.getBoundingClientRect().height/format().rows);
  space.style.setProperty('--ink-size',`${size}px`);space.style.setProperty('--ink-leading',`${leading}px`);space.style.setProperty('--cursor-inset',`${Math.max(0,(leading-size*1.3)/2)}px`);
  trackCaret();
 }
 function paintStrokes() {
  const overlay=$('nb-strokes');if(!overlay)return;
  const {columns,rows}=format();overlay.setAttribute('viewBox',`0 0 ${columns*20} ${rows*30}`);
  const paths=[];
  for(const run of strikeRuns(page(),format())){
   const x=run.start*20+1,w=(run.end-run.start)*20-2,y=run.row*30+15;
   const curve=(offset,reverse=false)=>reverse?`M${x+w} ${y+offset} C${x+w*.65} ${y+offset-3} ${x+w*.35} ${y+offset+3} ${x} ${y+offset-1}`:`M${x} ${y+offset} C${x+w*.28} ${y+offset-3} ${x+w*.62} ${y+offset+4} ${x+w} ${y+offset-1}`;
   if(run.passes===1)paths.push(`<path d="${curve(0)}" class="nb-stroke"/>`);
   else for(const [index,offset] of [-3,0,3].entries())paths.push(`<path d="${curve(offset,index%2===1)}" class="nb-stroke nb-stroke-heavy"/>`);
  }
  overlay.innerHTML=paths.join('');
 }
 function paintWrapMarkers() {
  const overlay=$('nb-wrap-markers');if(!overlay)return;
  const {continuations,warning}=lineContinuations(page(),format());
  const marker=(row,extra='')=>`<span class="nb-wrap-mark ${extra}" data-row="${row}" style="top:calc(${row} * var(--ink-leading, 1.5em) + var(--cursor-inset, 0px))">-</span>`;
  overlay.innerHTML=continuations.map(row=>marker(row,'nb-wrap-fixed')).join('')+(warning!==null?marker(warning,'nb-wrap-warning'):'');
 }
 function paint(caret=null) {
  const ink=page();$('nb-input').value=pageText(ink);
  $('nb-ink').innerHTML=ink.map(c=>c.struck?`<s data-passes="${inkPasses(c)}">${esc(c.char)}</s>`:esc(c.char)).join('');
  $('nb-count').textContent=`${pageSpace(ink,format())} / ${format().capacity}`;
  $('nb-full').hidden=pageSpace(ink,format())<format().capacity;
  paintStrokes();
  paintWrapMarkers();
  if(caret!==null){const offset=ink.slice(0,caret).map(c=>c.char).join('').length;$('nb-input').setSelectionRange(offset,offset);}
  $('nb-input').scrollTop=0;$('nb-input').scrollLeft=0;trackCaret();
 }
 function selection() {
  const input=$('nb-input');return {start:Array.from(input.value.slice(0,input.selectionStart)).length,end:Array.from(input.value.slice(0,input.selectionEnd)).length};
 }
 function change(operation) {
  try {const result=editPage(page(),{...operation,...format()});if($('nb-error'))$('nb-error').hidden=true;while(book.notebook.pages.length<=pageIndex)book.notebook.pages.push([]);book.notebook.pages[pageIndex]=result.page;if(!operation.deletion)interaction='write';paint(result.caret);setTool(interaction);save();}
  catch(error){paint();report(error);}
 }
 // iOS dictation, autocorrect and some composition events cannot be canceled.
 // Reconcile those native edits through the same non-destructive model.
 function reconcile() {
  const before=Array.from(pageText(page())),after=Array.from($('nb-input').value);let start=0,end=before.length,tail=after.length;
  while(start<end&&start<tail&&before[start]===after[start])start++;
  while(end>start&&tail>start&&before[end-1]===after[tail-1]){end--;tail--;}
  if(start===end&&start===tail){paint();return;}
  const text=after.slice(start,tail).join('');change({start,end,text,...(!text&&end>start?{deletion:'deleteContentBackward'}:{})});
 }
 function motion(element,frames,options={}) {
  if(!element?.animate||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return Promise.resolve();
  return element.animate(frames,{duration:180,easing:'cubic-bezier(.2,.7,.2,1)',...options}).finished.catch(()=>{});
 }
 async function turn(index) {
  index=Math.max(0,Math.min(book.notebook.pageCount-1,index));if(index===pageIndex||turning)return;
  turning=true;const direction=index>pageIndex?1:-1;const paper=$('nb-sheet');
  try{$('nb-input').blur();await queue;await motion(paper,[{transform:paper.style.transform||'translateX(0)',opacity:1},{transform:`translateX(${-direction*100}%)`,opacity:0}],{duration:140});
   pageIndex=index;interaction='read';remember();render();await motion($('nb-sheet'),[{transform:`translateX(${direction*45}px)`,opacity:0},{transform:'translateX(0)',opacity:1}]);
  }finally{turning=false;}
 }
 function closePanel() { $('nb-panel').hidden=true;for(const element of layer.querySelectorAll('.notebook-top,.nb-stage,.notebook-footer'))element.inert=false;$('nb-pages').focus({preventScroll:true}); }
 function panel(content) {
  $('nb-panel').innerHTML=`<button class="nb-panel-scrim" aria-label="Cerrar panel"></button><section class="nb-panel-card" role="dialog" aria-modal="true" aria-label="Panel del cuaderno">${content}</section>`;$('nb-panel').hidden=false;for(const element of layer.querySelectorAll('.notebook-top,.nb-stage,.notebook-footer'))element.inert=true;
  $('nb-panel').querySelector('.nb-panel-scrim').onclick=closePanel;$('nb-panel').querySelector('.nb-panel-card button')?.focus({preventScroll:true});
 }
 function pagesPanel() {
  setTool('read');
  panel(`<div class="nb-panel-heading"><strong>Hojas</strong><button class="icon-button" id="nb-panel-close" aria-label="Cerrar panel">${icon('close')}</button></div><div class="nb-page-grid">${Array.from({length:book.notebook.pageCount},(_,index)=>`<button class="nb-thumbnail ${index===pageIndex?'active':''}" data-page="${index}" aria-label="Ir a la hoja ${index+1}" ${index===pageIndex?'aria-current="page"':''}><span class="nb-thumbnail-text">${esc(pageText(book.notebook.pages[index]||[]).slice(0,100))}</span><span>${index+1}</span></button>`).join('')}</div><label class="nb-jump-label">Ir a la hoja <input id="nb-jump" type="number" inputmode="numeric" min="1" max="${book.notebook.pageCount}" value="${pageIndex+1}"></label>`);
  $('nb-panel-close').onclick=closePanel;
  for(const button of layer.querySelectorAll('[data-page]'))button.onclick=()=>{const index=Number(button.dataset.page);closePanel();return turn(index).catch(report);};
  $('nb-jump').onchange=event=>{const value=Number(event.target.value);if(Number.isInteger(value)&&value>=1&&value<=book.notebook.pageCount){closePanel();return turn(value-1).catch(report);}};
 }
 function bindSwipe() {
  const stage=$('nb-stage'),sheet=$('nb-sheet');let gesture=null;
  const reset=()=>{sheet.style.transform='';gesture=null;};
  stage.addEventListener('pointerdown',event=>{if(interaction!=='read'||turning||event.isPrimary===false||event.button>0||event.target.closest('button'))return;gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,locked:false};});
  stage.addEventListener('pointermove',event=>{if(!gesture||event.pointerId!==gesture.id)return;const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
   if(!gesture.locked){if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){reset();return;}if(Math.abs(dx)<10)return;gesture.locked=true;stage.setPointerCapture?.(event.pointerId);}
   event.preventDefault();gesture.dx=dx;const edge=dx>0&&pageIndex===0||dx<0&&pageIndex===book.notebook.pageCount-1;sheet.style.transform=`translateX(${dx*(edge ? 0.18 : 1)}px)`;
  },{passive:false});
  stage.addEventListener('pointerup',event=>{if(!gesture||event.pointerId!==gesture.id)return;const dx=event.clientX-gesture.x,locked=gesture.locked;gesture=null;const target=pageIndex+(dx<0?1:-1);if(locked&&Math.abs(dx)>55&&target>=0&&target<book.notebook.pageCount)turn(target).catch(report);else{sheet.style.transform='';if(locked)motion(sheet,[{transform:`translateX(${dx}px)`},{transform:'translateX(0)'}]);}});
  stage.addEventListener('pointercancel',reset);
 }
 function render() {
  shell(`<header class="notebook-top"><button class="icon-button" id="nb-close" aria-label="Volver a Guarda" title="Volver">${icon('back')}</button><div class="notebook-heading"><strong>${esc(book.title)}</strong></div><span id="nb-status" class="nb-save-indicator" role="status" aria-label="Guardado local">${icon('check')}</span><button class="icon-button" id="nb-shelf" aria-label="Cuadernos" title="Cuadernos">${icon('book')}</button><button class="icon-button" id="nb-info" aria-label="Ayuda del cuaderno" title="Ayuda">${icon('info')}</button></header><div class="nb-stage" id="nb-stage"><article class="nb-sheet" id="nb-sheet" aria-label="Hoja ${pageIndex+1}"><div class="notebook-page-caption"><span>${String(pageIndex+1).padStart(2,'0')}</span><span id="nb-count"></span></div><div class="notebook-writing-space" id="nb-writing-space" style="--nb-columns:${format().columns}ch;--nb-rows:${format().rows}"><div class="notebook-writing" id="nb-paper"><pre id="nb-ink" class="notebook-ink" aria-hidden="true"></pre><textarea id="nb-input" class="notebook-ink" aria-label="Escribir en la hoja ${pageIndex+1}. Borrar tacha el texto sin eliminarlo." aria-describedby="nb-help" wrap="soft" spellcheck="false" autocorrect="off" autocapitalize="sentences"></textarea><svg id="nb-strokes" class="nb-strokes" preserveAspectRatio="none" aria-hidden="true"></svg><div id="nb-wrap-markers" class="nb-wrap-markers" aria-hidden="true"></div><span id="nb-write-caret" class="notebook-write-caret" aria-hidden="true"></span></div></div><div class="notebook-full" id="nb-full" role="status" hidden>Hoja completa</div><div class="nb-page-progress" aria-hidden="true"><span style="width:${(pageIndex+1)/book.notebook.pageCount*100}%"></span></div></article></div><footer class="notebook-footer"><nav class="nb-dock" aria-label="Herramientas del cuaderno"><button class="icon-button" id="nb-prev" aria-label="Hoja anterior" ${pageIndex===0?'disabled':''}>${icon('back')}</button><button class="nb-page-button" id="nb-pages" aria-label="Ver todas las hojas" title="Ver hojas">${pageIndex+1}<span> / ${book.notebook.pageCount}</span></button><button class="icon-button" id="nb-next" aria-label="Hoja siguiente" ${pageIndex===book.notebook.pageCount-1?'disabled':''}>${icon('chevron')}</button><span class="nb-dock-divider"></span><button class="icon-button" id="nb-hand" aria-label="Leer y deslizar hojas" title="Leer y deslizar">${icon('hand')}</button><button class="icon-button" id="nb-write" aria-label="Escribir al final" title="Escribir">${icon('edit')}</button><button class="icon-button" id="nb-strike" aria-label="Tachar texto" title="Tachar">${icon('strike')}</button></nav><p id="nb-cursor-status" class="nb-sr-only" role="status"></p><p id="nb-help" class="nb-sr-only">Deslizá la hoja para avanzar. El lápiz abre el teclado. Lo nuevo se agrega al final. Seleccioná texto y usá Tachar para conservarlo tachado.</p></footer><div id="nb-panel" class="nb-panel" hidden></div>`);
  const input=$('nb-input');paint(page().length);setTool(interaction);syncViewport();bindSwipe();
  document.fonts?.load('16px "Guarda Hand"').then(()=>{if(layer.open&&book)syncViewport();}).catch(()=>{});
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(fit);observer.observe($('nb-writing-space'));}
  $('nb-shelf').onclick=()=>shelf().catch(report);
  $('nb-prev').onclick=()=>turn(pageIndex-1).catch(report);$('nb-next').onclick=()=>turn(pageIndex+1).catch(report);
  $('nb-pages').onclick=pagesPanel;
  $('nb-info').onclick=()=>{setTool('read');panel(`<div class="nb-panel-heading"><strong>Tu cuaderno</strong><button class="icon-button" id="nb-panel-close" aria-label="Cerrar panel">${icon('close')}</button></div><div class="nb-quick-help"><p>${icon('hand')}Deslizá para pasar de hoja.</p><p>${icon('edit')}Escribí siempre al final.</p><p>${icon('strike')}Lo tachado conserva su lugar.</p><small>${format().columns} letras por renglón · ${format().capacity} caracteres por hoja</small></div>`);$('nb-panel-close').onclick=closePanel;};
  $('nb-hand').onclick=()=>setTool('read');$('nb-write').onclick=()=>setTool('write',true);
  $('nb-strike').onpointerdown=event=>event.preventDefault();
  $('nb-strike').onclick=()=>{const range=selection();if(range.start!==range.end){change({...range,deletion:'deleteContentBackward'});setTool('strike',true);const text=pageText(page());input.setSelectionRange(Array.from(text).slice(0,range.start).join('').length,Array.from(text).slice(0,range.end).join('').length);trackCaret();}else setTool('strike',true);};
  input.addEventListener('beforeinput',event=>{
   if(interaction==='read'){event.preventDefault();return;}if(composition||event.isComposing||!event.cancelable)return;
   if(event.inputType.startsWith('history')){event.preventDefault();return;}
   if(event.inputType.startsWith('delete')){event.preventDefault();const range=selection();if(range.start===range.end&&/Word|Line/.test(event.inputType)){const text=pageText(page());if(event.inputType.includes('Backward'))range.start=Array.from(text.slice(0,input.selectionStart).replace(/\S+\s*$/u,'')).length;else range.end=range.start+Array.from(text.slice(input.selectionEnd).match(/^\s*\S+/u)?.[0]||'').length;}change({...range,deletion:event.inputType});return;}
   const text=/insertLineBreak|insertParagraph/.test(event.inputType)?'\n':event.data??event.dataTransfer?.getData('text/plain');
   if(text!=null){event.preventDefault();change({...selection(),text});}
  });
  input.addEventListener('paste',event=>{if(interaction==='read'){event.preventDefault();return;}if(!event.clipboardData)return;event.preventDefault();change({...selection(),text:event.clipboardData.getData('text/plain')});});
  input.addEventListener('cut',event=>{event.preventDefault();const range=selection();event.clipboardData?.setData('text/plain',input.value.slice(input.selectionStart,input.selectionEnd));change({...range,deletion:'deleteByCut'});});
  input.addEventListener('drop',event=>event.preventDefault());
  input.addEventListener('input',()=>{if(!composition)reconcile();});
  input.addEventListener('compositionstart',()=>composition=true);
  input.addEventListener('compositionend',()=>{composition=false;reconcile();});
  for(const event of ['select','keyup','pointerup'])input.addEventListener(event,trackCaret);
  input.addEventListener('focus',()=>{trackCaret();syncViewport();globalThis.requestAnimationFrame?.(syncViewport);});
  input.addEventListener('scroll',()=>{input.scrollTop=0;input.scrollLeft=0;});
 }
 layer.addEventListener('cancel',event=>{event.preventDefault();if($('nb-panel')&&!$('nb-panel').hidden){closePanel();return;}close().catch(report);});
 // The app's global keyboard shortcuts must not create ordinary notes here.
 layer.addEventListener('keydown',event=>event.stopPropagation());
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&book){if(composition){composition=false;reconcile();}save();}});
 window.addEventListener('pagehide',()=>{if(book)save();});
 for(const event of ['resize','scroll'])globalThis.visualViewport?.addEventListener(event,syncViewport);
 window.addEventListener('resize',syncViewport);
 layer.addEventListener('scroll',()=>{layer.scrollTop=0;layer.scrollLeft=0;});
 document.addEventListener('selectionchange',()=>{if(layer.open&&book)trackCaret();});
 return {get isOpen(){return layer.open;},flush:()=>queue,async open(){if(layer.open)return;previousFocus=document.activeElement;lockScroll();try{layer.showModal();}catch(error){unlockScroll();throw error;}syncViewport();let position;try{position=JSON.parse(storage?.getItem('guarda-notebook-position'));}catch{}if(position?.id)await openBook(position.id);else await shelf();}};
}
