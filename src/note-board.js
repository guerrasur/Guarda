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
  let cursor=grid.firstElementChild;
  for(const note of group.notes) {
   wanted.add(note.id);const key=keyOf(note);let card=cards.get(note.id);
   if(!card||card.guardaRenderKey!==key){
    const holder=document.createElement('div');holder.innerHTML=renderCard(note);const next=holder.firstElementChild;
    next.guardaRenderKey=key;if(card?.parentNode){if(cursor===card)cursor=next;card.replaceWith(next);}card=next;cards.set(note.id,card);
   }
   if(cursor!==card)grid.insertBefore(card,cursor);
   cursor=card.nextElementSibling;
  }
  layouts.push({grid,wanted});
 }
 // Move cards between sections before removing old groups.
 for(const {grid,wanted} of layouts)for(const child of [...grid.children])if(!wanted.has(child.dataset.note))child.remove();
 const ids=new Set(groups.map(group=>group.id));for(const section of [...area.children])if(!ids.has(section.dataset.group))section.remove();
}

// Unopened notes stay after opened notes in either direction.
export function compareNotes(a,b,mode='manual',direction='desc',opened={}) {
 const timestamp=n=>{const value=mode==='opened'?opened?.[n.id]:mode==='created'?n.createdAt:mode==='modified'?n.updatedAt:n.order??n.createdAt;return Number.isFinite(Number(value))?Number(value):0;};
 const av=timestamp(a),bv=timestamp(b);
 if(mode==='opened'&&!!av!==!!bv)return av?-1:1;
 return (mode!=='manual'&&direction==='asc'?av-bv:bv-av)||String(a.id).localeCompare(String(b.id));
}
