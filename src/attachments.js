export const MAX_FILE_BYTES=20*1024*1024;
export const MAX_NOTE_BYTES=50*1024*1024;
export function formatBytes(bytes){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;}
export function attachmentType(file){
 if(file.type&&file.type!=='application/octet-stream')return file.type;
 const ext=(file.name||'').split('.').pop().toLowerCase();
 return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',heic:'image/heic',heif:'image/heif',avif:'image/avif',pdf:'application/pdf',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',zip:'application/zip',txt:'text/plain'})[ext]||'application/octet-stream';
}
export function isPreviewImage(type){return ['image/jpeg','image/png','image/gif','image/webp','image/avif','image/bmp'].includes(type);}
export function validateFiles(files,existing=[]){
 for(const file of files){if(!Number.isFinite(file.size)||file.size<0)throw Error('No se pudo leer el tamaño del archivo.');if(file.size>MAX_FILE_BYTES)throw Error(`${file.name||'El archivo'} supera el límite de 20 MB por archivo.`);}
 const used=existing.reduce((sum,a)=>sum+(a.blob?.size||0),0);
 if(used+files.reduce((sum,f)=>sum+f.size,0)>MAX_NOTE_BYTES)throw Error('La selección supera el límite de 50 MB de adjuntos por nota. Elegí menos archivos o quitá algún adjunto.');
}
