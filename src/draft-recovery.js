// Synchronous text safety net: mobile browsers can terminate before IndexedDB commits.
const PREFIX='guarda-draft-v1:';
export class DraftRecovery {
 constructor(storage){this.storage=storage;}
 capture(note){const value=JSON.stringify(note);this.storage?.setItem(PREFIX+note.id,value);return value;}
 acknowledge(id,value){if(this.storage?.getItem(PREFIX+id)===value)this.storage.removeItem(PREFIX+id);}
 async recover(store){
  if(!this.storage)return [];
  const keys=Array.from({length:this.storage.length},(_,i)=>this.storage.key(i)).filter(k=>k?.startsWith(PREFIX));
  const recovered=[];
  for(const key of keys){
   const value=this.storage.getItem(key);let note;try{note=JSON.parse(value);}catch{continue;}
   if(!note||key!==PREFIX+note.id||typeof note.title!=='string'||typeof note.body!=='string'||!Array.isArray(note.items)||!Array.isArray(note.labels)||!Array.isArray(note.attachments)||!Number.isFinite(note.updatedAt))continue;
   const current=(await store.allNotes()).find(n=>n.id===note.id);
   if(current&&JSON.stringify(current)===value){this.acknowledge(note.id,value);continue;}
   // Keep concurrent edits/deletions intact; retain the interrupted text as a copy.
   const target=current&&(current.deletedAt||current.updatedAt>note.updatedAt)?{...note,id:crypto.randomUUID(),title:(note.title||'Nota')+' (recuperada)',attachments:[],deletedAt:null}:note;
   await store.putNote(target);this.acknowledge(note.id,value);recovered.push(target.id);
  }
  return recovered;
 }
}
