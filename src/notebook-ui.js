import { createNotebook, editPage, isNotebook, pageText, pageSpace, notebookFormat } from './notebook.js';
import { DraftRecovery } from './draft-recovery.js';
import { icon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initNotebooks({store, showError, onClose, onPending}) {
 const layer = document.createElement('dialog'); layer.className='notebook-layer'; layer.setAttribute('aria-label','Modo cuaderno'); document.body.append(layer);
 let storage; try { storage=globalThis.localStorage; } catch {}
 const recovery=new DraftRecovery(storage);
 let book=null, pageIndex=0, queue=Promise.resolve(), busy=false, composition=false, previousFocus=null, observer=null;
 const $=id=>layer.querySelector(`#${id}`);
 const page=()=>book.notebook.pages[pageIndex] || [];
 const format=()=>notebookFormat(book);
 function report(error) { const banner=$('nb-error');if(banner){banner.textContent=error.message;banner.hidden=false;}showError(error); }
 function remember() { try { storage?.setItem('guarda-notebook-position',JSON.stringify({id:book.id,page:pageIndex})); storage?.setItem('guarda-notebook-page:'+book.id,String(pageIndex)); } catch(error) { report(error); } }
 function save() {
  book.updatedAt=Date.now(); book.body=book.notebook.pages.map(pageText).join('\n\n');
  const snapshot=structuredClone(book); let journal;
  try { journal=recovery.capture(snapshot); } catch(error) { report(error); }
  onPending?.();
  queue=queue.catch(()=>{}).then(async()=>{
   await store.putNote(snapshot); if(journal)recovery.acknowledge(snapshot.id,journal);
   if($('nb-status'))$('nb-status').textContent='Guardado local';
  }).catch(error=>{if($('nb-status'))$('nb-status').textContent='Error al guardar';report(error);throw error;});
  // Keep failures observable by flush, without an unhandled rejection while typing.
  queue.catch(()=>{}); if($('nb-status'))$('nb-status').textContent='Guardando…';
  return queue;
 }
 async function close() { await queue; layer.close(); observer?.disconnect(); book=null; onClose?.(); previousFocus?.focus?.({preventScroll:true}); }
 function bindClose() { $('nb-close').onclick=()=>close().catch(report); }
 function shell(content) { observer?.disconnect(); layer.innerHTML=`<div class="notebook-app">${content}<p class="notebook-error" id="nb-error" role="alert" hidden></p></div>`; bindClose(); }
 async function shelf(forceCreate=false) {
  await queue; book=null;
  const books=(await store.allNotes()).filter(n=>isNotebook(n)&&!n.deletedAt);
  shell(`<header class="notebook-top"><button class="icon-button" id="nb-close" aria-label="Volver a Guarda">${icon('back')}</button><strong>Cuadernos <small>Prototipo</small></strong></header><div class="notebook-shelf"><h1>Un cuaderno para llenar.</h1><p>Cuadernos finitos de 25, 50 o 100 hojas, en orden fijo. Escribí, volvé y continuá. Al borrar, el texto se tacha y conserva su lugar.</p><form id="nb-create"><label for="nb-title">Título del nuevo cuaderno</label><input id="nb-title" maxlength="120" placeholder="Mi cuaderno" required autocomplete="off"><label for="nb-size">Tamaño del cuaderno</label><select id="nb-size"><option value="25">Pequeño · 25 hojas</option><option value="50">Mediano · 50 hojas</option><option value="100">Grande · 100 hojas</option></select><label for="nb-capacity">Capacidad de cada hoja</label><select id="nb-capacity"><option value="250">250 caracteres</option><option value="200">200 caracteres</option></select><small>El tamaño se mantiene al cambiar de pantalla. Los saltos de línea y lo tachado ocupan espacio.</small><button class="text-button" type="submit">Crear cuaderno</button></form><div class="notebook-books">${books.map(n=>`<button class="notebook-cover" data-book="${esc(n.id)}">${icon('book')}<strong>${esc(n.title)}</strong><span>${n.notebook.pageCount} hojas · ${notebookFormat(n).capacity} caracteres por hoja</span></button>`).join('')}</div></div>`);
  $('nb-create').onsubmit=async event=>{event.preventDefault();if(busy)return;const title=$('nb-title').value.trim();if(!title){$('nb-title').focus();return;}busy=true;try{book=createNotebook(title,{pageCount:Number($('nb-size').value),capacity:Number($('nb-capacity').value)});pageIndex=0;await save();remember();render();}catch(error){report(error);}finally{busy=false;}};
  for(const button of layer.querySelectorAll('[data-book]'))button.onclick=()=>openBook(button.dataset.book).catch(report);
  if(forceCreate)$('nb-title').focus();
 }
 async function openBook(id) {
  await queue; const found=(await store.allNotes()).find(n=>n.id===id&&isNotebook(n)&&!n.deletedAt); if(!found){await shelf();return;}
  book=structuredClone(found);let position;try{position=JSON.parse(storage?.getItem('guarda-notebook-position'));}catch{}
  let savedPage;try{savedPage=storage?.getItem('guarda-notebook-page:'+id);}catch{}
  pageIndex=Math.max(0,Math.min(book.notebook.pageCount-1,Number(savedPage??(position?.id===id?position.page:0))||0));remember();render();
 }
 function fit() {
  const space=$('nb-writing-space'); if(!space)return;
  const r=space.getBoundingClientRect();
  const size=Math.max(1,Math.min((r.width-32)/(format().columns*.6021),(r.height-12)/(format().rows*1.5)));
  space.style.setProperty('--ink-size',`${size}px`);
 }
 function paint(caret=null) {
  const ink=page();$('nb-input').value=pageText(ink);
  $('nb-ink').innerHTML=ink.map(c=>c.struck?`<s>${esc(c.char)}</s>`:esc(c.char)).join('');
  $('nb-count').textContent=`${pageSpace(ink,format())} / ${format().capacity}`;
  $('nb-full').hidden=pageSpace(ink,format())<format().capacity;
  if(caret!==null){const offset=ink.slice(0,caret).map(c=>c.char).join('').length;$('nb-input').setSelectionRange(offset,offset);}
 }
 function selection() {
  const input=$('nb-input');return {start:Array.from(input.value.slice(0,input.selectionStart)).length,end:Array.from(input.value.slice(0,input.selectionEnd)).length};
 }
 function change(operation) {
  try {const result=editPage(page(),{...operation,...format()});if($('nb-error'))$('nb-error').hidden=true;while(book.notebook.pages.length<=pageIndex)book.notebook.pages.push([]);book.notebook.pages[pageIndex]=result.page;paint(result.caret);save();}
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
 function render() {
  shell(`<header class="notebook-top"><button class="icon-button" id="nb-close" aria-label="Volver a Guarda">${icon('back')}</button><div class="notebook-heading"><strong>${esc(book.title)}</strong><small id="nb-status" role="status">Guardado local</small></div><button class="text-button" id="nb-shelf">Cuadernos</button></header><div class="notebook-page-caption"><span>HOJA ${String(pageIndex+1).padStart(2,'0')}</span><span id="nb-count"></span></div><div class="notebook-writing-space" id="nb-writing-space" style="--nb-columns:${format().columns}ch;--nb-lines:${format().rows*1.5}em"><div class="notebook-writing"><pre id="nb-ink" class="notebook-ink" aria-hidden="true"></pre><textarea id="nb-input" class="notebook-ink" aria-label="Escribir en la hoja ${pageIndex+1}. Borrar tacha el texto sin eliminarlo." aria-describedby="nb-help" wrap="soft" spellcheck="false" autocorrect="off" autocapitalize="sentences"></textarea></div></div><div class="notebook-full" id="nb-full" role="status" hidden>Hoja completa. Pasá a la siguiente.</div><footer class="notebook-footer"><div class="notebook-pagination"><button class="icon-button" id="nb-prev" aria-label="Hoja anterior" ${pageIndex===0?'disabled':''}>${icon('back')}</button><label>Hoja <input id="nb-jump" type="number" inputmode="numeric" min="1" max="${book.notebook.pageCount}" value="${pageIndex+1}" aria-label="Ir a la hoja"> de ${book.notebook.pageCount}</label><button class="icon-button" id="nb-next" aria-label="Hoja siguiente" ${pageIndex===book.notebook.pageCount-1?'disabled':''}>${icon('chevron')}</button><button class="text-button" id="nb-strike">Tachar</button></div><p id="nb-help">Seleccioná texto y tocá Tachar, o usá borrar. El espacio escrito no se recupera.</p></footer>`);
  const input=$('nb-input');paint();fit();
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(fit);observer.observe($('nb-writing-space'));}
  $('nb-shelf').onclick=()=>shelf().catch(report);
  async function turn(index){input.blur();await queue;pageIndex=Math.max(0,Math.min(book.notebook.pageCount-1,index));remember();render();}
  $('nb-prev').onclick=()=>turn(pageIndex-1).catch(report);$('nb-next').onclick=()=>turn(pageIndex+1).catch(report);
  $('nb-jump').onchange=event=>{const value=Number(event.target.value);if(Number.isInteger(value)&&value>=1&&value<=book.notebook.pageCount)turn(value-1).catch(report);else event.target.value=pageIndex+1;};
  $('nb-strike').onpointerdown=event=>event.preventDefault();
  $('nb-strike').onclick=()=>{const range=selection();if(range.start===range.end){report(Error('Seleccioná el texto que querés tachar.'));return;}change({...range,deletion:'deleteContentBackward'});input.focus({preventScroll:true});};
  input.addEventListener('beforeinput',event=>{
   if(composition||event.isComposing||!event.cancelable)return;
   if(event.inputType.startsWith('history')){event.preventDefault();return;}
   if(event.inputType.startsWith('delete')){event.preventDefault();const range=selection();if(range.start===range.end&&/Word|Line/.test(event.inputType)){const text=pageText(page());if(event.inputType.includes('Backward'))range.start=Array.from(text.slice(0,input.selectionStart).replace(/\S+\s*$/u,'')).length;else range.end=range.start+Array.from(text.slice(input.selectionEnd).match(/^\s*\S+/u)?.[0]||'').length;}change({...range,deletion:event.inputType});return;}
   const text=/insertLineBreak|insertParagraph/.test(event.inputType)?'\n':event.data??event.dataTransfer?.getData('text/plain');
   if(text!=null){event.preventDefault();change({...selection(),text});}
  });
  input.addEventListener('paste',event=>{if(!event.clipboardData)return;event.preventDefault();change({...selection(),text:event.clipboardData.getData('text/plain')});});
  input.addEventListener('cut',event=>{event.preventDefault();const range=selection();event.clipboardData?.setData('text/plain',input.value.slice(input.selectionStart,input.selectionEnd));change({...range,deletion:'deleteByCut'});});
  input.addEventListener('drop',event=>event.preventDefault());
  input.addEventListener('input',()=>{if(!composition)reconcile();});
  input.addEventListener('compositionstart',()=>composition=true);
  input.addEventListener('compositionend',()=>{composition=false;reconcile();});
 }
 layer.addEventListener('cancel',event=>{event.preventDefault();close().catch(report);});
 // The app's global keyboard shortcuts must not create ordinary notes here.
 layer.addEventListener('keydown',event=>event.stopPropagation());
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&book){if(composition){composition=false;reconcile();}save();}});
 window.addEventListener('pagehide',()=>{if(book)save();});
 globalThis.visualViewport?.addEventListener('resize',()=>{if(layer.open){layer.style.setProperty('--notebook-height',`${visualViewport.height}px`);fit();}});
 return {get isOpen(){return layer.open;},flush:()=>queue,async open(){previousFocus=document.activeElement;layer.showModal();if(globalThis.visualViewport)layer.style.setProperty('--notebook-height',`${visualViewport.height}px`);let position;try{position=JSON.parse(storage?.getItem('guarda-notebook-position'));}catch{}if(position?.id)await openBook(position.id);else await shelf();}};
}
