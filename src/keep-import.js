import { Unzip,UnzipInflate } from './vendor/fflate.js';
import { fingerprint } from './cloud-merge.js';
const MAX_INPUT=100*1024*1024,MAX_TOTAL=200*1024*1024,MAX_FILE=50*1024*1024,MAX_JSON=8*1024*1024,MAX_ENTRIES=12000;
const mimeByExtension={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',avif:'image/avif',heic:'image/heic',heif:'image/heif',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',webm:'audio/webm','3gp':'audio/3gpp'};
const extension=path=>path.split('.').at(-1).toLowerCase();
function normalizePath(path){
 if(typeof path!=='string'||/^[a-z]+:/i.test(path)||path.includes('\0')||path.startsWith('/'))throw Error('La copia contiene una ruta de archivo no válida.');
 const segments=[];for(const part of path.replaceAll('\\','/').split('/')){if(!part||part==='.')continue;if(part==='..'){if(!segments.length)throw Error('La copia contiene una ruta fuera de su carpeta.');segments.pop();}else segments.push(part);}return segments.join('/');
}
export async function readKeepFiles(files){
 if(!files.length)throw Error('Elegí el ZIP de Google Takeout o los archivos JSON de Keep.');
 if(files.reduce((n,f)=>n+f.size,0)>MAX_INPUT)throw Error('Seleccioná como máximo 100 MB por importación. Dividí la copia o importala por partes.');
 const entries=new Map();let total=0,count=0;
 function add(path,data){path=normalizePath(path);if(entries.has(path)){const other=entries.get(path);if(other.length!==data.length||other.some((v,i)=>v!==data[i]))throw Error('Hay archivos diferentes con el mismo nombre. Importá esas copias por separado.');return;}entries.set(path,data);}
 for(const file of files){
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(/\.zip$/i.test(file.name)){
   if(bytes[0]!==0x50||bytes[1]!==0x4b)throw Error('El archivo elegido no es un ZIP válido.');
   let failure=null;const pending=new Set();
   const unzip=new Unzip(entry=>{
    if(++count>MAX_ENTRIES){failure=Error('La copia contiene demasiados archivos. Exportá solamente Google Keep.');return;}
    if(entry.name.endsWith('/'))return;
    let path;try{path=normalizePath(entry.name);}catch(error){failure=error;return;}
    const ext=extension(path);if(ext!=='json'&&!mimeByExtension[ext])return;
    const limit=ext==='json'?MAX_JSON:MAX_FILE;
    if(entry.originalSize>limit){failure=Error('Un archivo de la copia es demasiado grande. Importá una copia más pequeña.');return;}
    const chunks=[];let size=0;pending.add(path);
    entry.ondata=(error,chunk,final)=>{
     if(failure)return;if(error){failure=Error('No se pudo descomprimir la copia de Keep.');return;}
     size+=chunk.length;total+=chunk.length;if(size>limit||total>MAX_TOTAL){failure=Error('La copia descomprimida es demasiado grande. Importala por partes.');entry.terminate?.();return;}
     chunks.push(chunk);
     if(final){const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}try{add(path,data);}catch(error){failure=error;}pending.delete(path);}
    };entry.start();
   });unzip.register(UnzipInflate);
   try{for(let offset=0;offset<bytes.length;offset+=2048){if(failure)throw failure;unzip.push(bytes.subarray(offset,offset+2048),offset+2048>=bytes.length);if(offset%262144===0)await new Promise(resolve=>setTimeout(resolve,0));}}
   catch(error){throw failure||Error('No se pudo abrir el ZIP. Descargalo nuevamente desde Google Takeout.');}
   if(failure)throw failure;if(pending.size)throw Error('El ZIP está incompleto. Descargá nuevamente la copia de Keep.');
  }else{
   if(++count>MAX_ENTRIES)throw Error('Elegí menos archivos por importación.');const path=normalizePath(file.webkitRelativePath||file.name),ext=extension(path);if(ext!=='json'&&!mimeByExtension[ext])continue;
   if(bytes.length>(ext==='json'?MAX_JSON:MAX_FILE))throw Error('Uno de los archivos es demasiado grande.');total+=bytes.length;if(total>MAX_TOTAL)throw Error('La copia es demasiado grande.');add(path,bytes);
  }
 }
 return entries;
}
const timestamp=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n/1000):null;};
const colors={DEFAULT:'default',RED:'coral',ORANGE:'peach',YELLOW:'sand',GREEN:'mint',TEAL:'sage',BLUE:'storm',CERULEAN:'fog',PURPLE:'dusk',PINK:'blossom',BROWN:'clay',GRAY:'slate',GREY:'slate'};
function keepNote(value){return value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.title==='string'&&['textContent','listContent','createdTimestampUsec','isPinned','isArchived'].some(k=>Object.hasOwn(value,k));}
function resolveAttachment(entries,jsonPath,reference){
 if(typeof reference!=='string'||!reference)return null;
 const folder=jsonPath.includes('/')?jsonPath.slice(0,jsonPath.lastIndexOf('/')+1):'';
 let options;try{options=[normalizePath(folder+reference),normalizePath(reference)];}catch{return null;}
 for(const path of options)if(entries.has(path))return {path,bytes:entries.get(path)};
 const basename=reference.replaceAll('\\','/').split('/').at(-1),candidates=[...entries.keys()].filter(path=>path.split('/').at(-1)===basename);
 return candidates.length===1?{path:candidates[0],bytes:entries.get(candidates[0])}:null;
}
export async function prepareKeepImport(files,{existingNotes=[],existingLabels=[]}={}){
 const entries=await readKeepFiles(files),notes=[],labels=[],attachments=[],warnings=[],known=new Set(existingNotes.map(n=>n.id)),usedLabelIds=new Set(existingLabels.map(l=>l.id));let skipped=0;
 const labelMap=new Map(existingLabels.map(l=>[l.name.normalize('NFC').trim().toLocaleLowerCase('es'),l.id]));
 for(const [path,bytes] of entries){
  if(extension(path)!=='json')continue;let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('No se pudo leer el JSON '+path.split('/').at(-1)+'. La copia no se modificó.');}
  if(!keepNote(data))continue;
  if(data.textContent!==undefined&&typeof data.textContent!=='string'||data.listContent!==undefined&&(!Array.isArray(data.listContent)||data.listContent.some(i=>typeof i?.text!=='string'))||data.labels!==undefined&&(!Array.isArray(data.labels)||data.labels.some(l=>typeof l?.name!=='string'))||data.attachments!==undefined&&!Array.isArray(data.attachments))throw Error('La nota '+(data.title||path)+' tiene un formato de Keep no compatible.');
  const sourceFiles=[];
  for(const ref of data.attachments||[]){const match=resolveAttachment(entries,path,ref?.filePath);const type=match?mimeByExtension[extension(match.path)]:null;if(!match||!type){warnings.push('No se incluyó un adjunto de “'+(data.title||'Nota sin título')+'”: '+(ref?.filePath||'archivo sin nombre'));continue;}sourceFiles.push({...match,type});}
  const fileHashes=[];for(const f of sourceFiles){const hash=await crypto.subtle.digest('SHA-256',f.bytes);fileHashes.push([...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join(''));}
  const id='keep-'+await fingerprint({data,fileHashes});if(known.has(id)){skipped++;continue;}known.add(id);
  const created=timestamp(data.createdTimestampUsec)||timestamp(data.userEditedTimestampUsec)||Date.now(),updated=timestamp(data.userEditedTimestampUsec)||created;
  const items=(data.listContent||[]).map((i,index)=>({id:id+'-item-'+index,text:i.text,checked:i.isChecked===true}));
  const note={id,title:data.title,body:data.textContent||'',richBody:'',isList:Array.isArray(data.listContent)&&data.listContent.length>0,items,labels:[],attachments:[],pinned:data.isPinned===true,archived:data.isArchived===true,deletedAt:data.isTrashed===true?updated:null,color:colors[data.color]||'default',background:'none',createdAt:created,updatedAt:updated,reminderAt:null,order:updated,source:'google-keep'};
  if(items.length&&note.body.trim())items.unshift({id:id+'-text',text:note.body,checked:false});
  for(const l of data.labels||[]){const name=l.name.normalize('NFC').trim();if(!name)continue;const key=name.toLocaleLowerCase('es');if(!labelMap.has(key)){let labelId='keep-label-'+await fingerprint(key);while(usedLabelIds.has(labelId))labelId='keep-label-'+crypto.randomUUID();usedLabelIds.add(labelId);labels.push({id:labelId,name});labelMap.set(key,labelId);}if(!note.labels.includes(labelMap.get(key)))note.labels.push(labelMap.get(key));}
  for(let index=0;index<sourceFiles.length;index++){const f=sourceFiles[index],attachmentId=id+'-file-'+index;note.attachments.push(attachmentId);attachments.push({id:attachmentId,noteId:id,type:f.type,name:f.path.split('/').at(-1),createdAt:created,blob:new Blob([f.bytes],{type:f.type})});}
  notes.push(note);
 }
 if(!notes.length&&!skipped)throw Error('No se encontraron notas de Google Keep. Elegí el ZIP de Takeout que incluya sus archivos JSON.');
 return {notes,labels,attachments,skipped,warnings};
}
