// Reconcile by note ID: unchanged cards keep their images, focus and DOM.
export function renderNoteGroups(area, groups, {keyOf, renderCard}) {
 const document=area.ownerDocument;
 const cards=new Map([...area.querySelectorAll('[data-note]')].map(card=>[card.dataset.note,card]));
 const sections=new Map([...area.children].map(section=>[section.dataset.group,section]));
 const layouts=[];
 for(const [index,group] of groups.entries()) {
  let section=sections.get(group.id);
  if(!section){section=document.createElement('section');section.dataset.group=group.id;section.className='notes-group';section.innerHTML='<h2 class="notes-section-title"></h2><div class="notes-grid"></div>';}
  if(area.children[index]!==section)area.insertBefore(section,area.children[index]||null);
  const heading=section.querySelector('h2');heading.hidden=!group.label;if(heading.textContent!==group.label)heading.textContent=group.label||'';
  const grid=section.querySelector('.notes-grid'),wanted=new Set();
  for(const [position,note] of group.notes.entries()) {
   wanted.add(note.id);const key=keyOf(note);let card=cards.get(note.id);
   if(!card||card.guardaRenderKey!==key){
    const holder=document.createElement('div');holder.innerHTML=renderCard(note);const next=holder.firstElementChild;
    next.guardaRenderKey=key;if(card?.parentNode)card.replaceWith(next);card=next;cards.set(note.id,card);
   }
   if(grid.children[position]!==card)grid.insertBefore(card,grid.children[position]||null);
  }
  layouts.push({grid,wanted});
 }
 // Move cards between sections before removing old groups.
 for(const {grid,wanted} of layouts)for(const child of [...grid.children])if(!wanted.has(child.dataset.note))child.remove();
 const ids=new Set(groups.map(group=>group.id));for(const section of [...area.children])if(!ids.has(section.dataset.group))section.remove();
}
