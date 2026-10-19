// Vector clocks distinguish edits made after a sync from simultaneous offline edits.
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(v=>canonical(v)??'null').join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function fingerprint(value){const bytes=new TextEncoder().encode(canonical(value));const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');}
const join=clocks=>{const result=Object.create(null);for(const c of clocks)for(const [d,n] of Object.entries(c))result[d]=Math.max(result[d]||0,n);return result;};
const dominates=(a,b)=>Object.entries(b).every(([d,n])=>(a[d]||0)>=n);
export function backupUnits(backup){
 const attachments=new Map(backup.attachments.map(a=>[a.id,a]));const units=new Map();
 for(const note of backup.notes){const files=note.attachments.map(id=>attachments.get(id));if(files.some(a=>!a||a.draft))throw Error('Hay una grabación pendiente de recuperar. Cerrá y volvé a abrir Guarda.');units.set('note:'+note.id,{note,attachments:files});}
 for(const label of backup.labels)units.set('label:'+label.id,label);
 return units;
}
export async function localRecords(backup,heads,device){
 const units=backupUnits(backup),records=[];
 for(const key of new Set([...units.keys(),...Object.keys(heads)])){
  const value=units.get(key)??null,deleted=value===null,signature=await fingerprint(value),previous=heads[key];
  if(!previous&&deleted)continue;
  const clock={...(previous?.clock||{})};if(!previous||previous.signature!==signature||!!previous.deleted!==deleted)clock[device]=(clock[device]||0)+1;
  records.push({key,clock,deleted,value});
 }
 return records;
}
export function validateRelease(data){
 if(data?.format!=='guarda-drive-sync'||data.version!==1||!Array.isArray(data.records))throw Error('Un archivo de sincronización de Guarda tiene formato incompatible.');
 for(const r of data.records){
  if(!r||typeof r.key!=='string'||! /^(note|label):.{1,500}$/.test(r.key)||typeof r.deleted!=='boolean'||!r.clock||Array.isArray(r.clock)||!Object.keys(r.clock).length||!Object.entries(r.clock).every(([d,n])=>/^[a-zA-Z0-9_-]{1,100}$/.test(d)&&Number.isSafeInteger(n)&&n>0))throw Error('Un archivo de sincronización está dañado.');
  if(r.deleted?r.value!==null:r.key.startsWith('note:')?r.value?.note?.id!==r.key.slice(5)||!Array.isArray(r.value.attachments):r.value?.id!==r.key.slice(6))throw Error('Un registro de sincronización no corresponde a su nota o etiqueta.');
  if(!r.deleted){const n=r.key.startsWith('note:')?r.value.note:null;if(n&&(typeof n.title!=='string'||typeof n.body!=='string'||!Array.isArray(n.labels)||!Array.isArray(n.attachments)||!Array.isArray(n.items)))throw Error('El texto o los campos de una nota de Drive no son válidos.');if(!n&&typeof r.value.name!=='string')throw Error('Una etiqueta de Drive no es válida.');}
 }
 return data.records;
}
export async function mergeRecords(groups){
 const byKey=new Map();for(const records of groups)for(const r of records){if(!byKey.has(r.key))byKey.set(r.key,[]);byKey.get(r.key).push(r);}
 const resolved=new Map(),copies=[];let conflicts=0;
 for(const [key,variants] of byKey){
  const unique=[...new Map(variants.map(r=>[canonical(r),r])).values()];
  const frontier=unique.filter(r=>!unique.some(s=>s!==r&&dominates(s.clock,r.clock)&&!dominates(r.clock,s.clock)));
  // Prefer an edit over a concurrent permanent deletion, and choose consistently
  // across devices. Distinct live edits are retained in separate conflict notes.
  const live=frontier.filter(r=>!r.deleted).sort((a,b)=>canonical(a.value)<canonical(b.value)?-1:canonical(a.value)>canonical(b.value)?1:0);
  const winner=live.at(-1)||frontier[0],clock=join(frontier.map(r=>r.clock));
  resolved.set(key,{...winner,clock});
  const distinct=[...new Map(live.map(r=>[canonical(r.value),r])).values()];
  for(const r of distinct){if(canonical(r.value)===canonical(winner.value))continue;
   const suffix='--conflict-'+(await fingerprint(r.value)).slice(0,16);
   const id=key.slice(key.indexOf(':')+1)+suffix;
   let value;if(key.startsWith('note:')){
    const note={...r.value.note,id,title:(r.value.note.title||'Nota sin título')+' (conflicto)'};
    const attachments=r.value.attachments.map(a=>({...a,id:a.id+suffix,noteId:id}));note.attachments=attachments.map(a=>a.id);value={note,attachments};
   }else value={...r.value,id,name:r.value.name+' (conflicto)'};
   copies.push({key:key.slice(0,key.indexOf(':')+1)+id,clock,deleted:false,value});conflicts++;
  }
 }
 for(const r of copies)if(!resolved.has(r.key))resolved.set(r.key,r);
 return {records:[...resolved.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0),conflicts};
}
export function materialize(records){
 const notes=[],labels=[],attachments=[];for(const r of records){if(r.deleted)continue;if(r.key.startsWith('note:')){notes.push(structuredClone(r.value.note));attachments.push(...structuredClone(r.value.attachments));}else labels.push(structuredClone(r.value));}
 const labelIds=new Set(labels.map(l=>l.id));for(const n of notes)n.labels=n.labels.filter(id=>labelIds.has(id));
 return {format:'guarda-backup',version:1,notes,labels,attachments,settings:[]};
}
export async function recordHeads(records){const result={};for(const r of records)result[r.key]={clock:r.clock,deleted:r.deleted,signature:await fingerprint(r.value)};return result;}
