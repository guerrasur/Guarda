export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const API='https://www.googleapis.com/drive/v3/';
export class DriveClient{
 constructor({env=globalThis,onStatus=()=>{}}={}){this.env=env;this.onStatus=onStatus;this.token=null;this.expires=0;this.user=null;this.oauth=null;this.pending=null;}
 get connected(){return !!this.token&&Date.now()<this.expires&&!!this.user;}
 async prepare(clientId){
  if(!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))throw Error('Falta el ID de cliente OAuth de Guarda.');
  if(!this.env.google?.accounts?.oauth2){
   if(!this.loading)this.loading=new Promise((resolve,reject)=>{const script=this.env.document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;const timer=this.env.setTimeout(()=>{script.remove();this.loading=null;reject(Error('No se pudo cargar la conexión con Google. Revisá internet.'));},20000);script.onload=()=>{this.env.clearTimeout(timer);resolve();};script.onerror=()=>{this.env.clearTimeout(timer);script.remove();this.loading=null;reject(Error('No se pudo cargar la conexión con Google.'));};this.env.document.head.append(script);});
   await this.loading;
  }
  this.oauth=this.env.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:DRIVE_SCOPE,include_granted_scopes:false,
   callback:response=>this.finishAuthorization(response),error_callback:()=>this.rejectAuthorization(Error('Se cerró o bloqueó la ventana de Google. Tocá Conectar para reintentar.'))});
 }
 rejectAuthorization(error){const pending=this.pending;this.pending=null;pending?.reject(error);}
 connect(){
  if(!this.oauth)return Promise.reject(Error('Primero configurá la conexión con Google.'));
  if(this.pending)return Promise.reject(Error('La conexión con Google ya está en curso.'));
  return new Promise((resolve,reject)=>{this.pending={resolve,reject};try{this.oauth.requestAccessToken({prompt:'select_account'});}catch(error){this.rejectAuthorization(error);}});
 }
 async finishAuthorization(response){
  if(!this.pending)return;
  try{
   if(response.error||!response.access_token||!this.env.google.accounts.oauth2.hasGrantedAllScopes(response,DRIVE_SCOPE))throw Error('No se autorizó el acceso a los archivos de Guarda en Drive.');
   this.token=response.access_token;this.expires=Date.now()+Math.max(0,Number(response.expires_in||0)-60)*1000;
   const data=await this.request('about?fields=user(permissionId,emailAddress,displayName),storageQuota');
   if(!data.user?.permissionId)throw Error('No se pudo identificar la cuenta de Drive.');
   this.user=data.user;const pending=this.pending;this.pending=null;pending.resolve(data.user);
  }catch(error){this.disconnect();this.rejectAuthorization(error);}
 }
 disconnect(){this.token=null;this.expires=0;this.user=null;}
 async request(path,{method='GET',body,headers={},raw=false}={}){
  if(!this.token||Date.now()>=this.expires){this.disconnect();throw Error('La sesión de Drive venció. Tocá Conectar para renovarla; tus notas siguen guardadas localmente.');}
  const url=path.startsWith('https://')?path:API+path;
  if(!url.startsWith(API)&&!url.startsWith('https://www.googleapis.com/upload/drive/v3/'))throw Error('Dirección de Drive no válida.');
  const controller=new this.env.AbortController(),timer=this.env.setTimeout(()=>controller.abort(),120000);
  try{
   const response=await this.env.fetch(url,{method,headers:{...headers,Authorization:'Bearer '+this.token},body,signal:controller.signal,cache:'no-store'});
   if(response.status===401){this.disconnect();throw Error('La sesión de Drive venció. Volvé a conectar tu cuenta.');}
   if(!response.ok){let reason='';try{reason=(await response.json()).error?.errors?.[0]?.reason||'';}catch{}
    if(reason==='storageQuotaExceeded')throw Error('Tu cuenta de Drive no tiene espacio disponible. Tus cambios siguen guardados localmente.');
    if(response.status===403||response.status===429)throw Error('Drive rechazó la solicitud por permisos o límites de uso. Revisá la API y el permiso drive.file.');
    throw Error('No se pudo completar la sincronización con Drive. Se conservaron tus cambios locales.');
   }
   if(raw)return response;return response.status===204?null:await response.json();
  }finally{this.env.clearTimeout(timer);}
 }
 async listSnapshots(){
  const files=[];let pageToken='';
  do{const query=new URLSearchParams({q:"trashed = false and appProperties has { key='guarda' and value='sync-v1' }",fields:'nextPageToken,files(id,name,modifiedTime,appProperties)',pageSize:'1000'});if(pageToken)query.set('pageToken',pageToken);const data=await this.request('files?'+query);files.push(...data.files);pageToken=data.nextPageToken||'';}while(pageToken);
  return files;
 }
 readSnapshot(id){return this.request('files/'+encodeURIComponent(id)+'?alt=media');}
 async writeSnapshot(device,payload,fileId){
  const content=new Blob([JSON.stringify(payload)],{type:'application/json'});
  const metadata=fileId?{name:'Guarda-'+device+'.json'}:{name:'Guarda-'+device+'.json',mimeType:'application/json',appProperties:{guarda:'sync-v1',device},parents:[await this.ensureFolder()]};
  const url='https://www.googleapis.com/upload/drive/v3/files'+(fileId?'/'+encodeURIComponent(fileId):'')+'?uploadType=resumable&fields=id';
  const session=await this.request(url,{method:fileId?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(content.size)},body:JSON.stringify(metadata),raw:true});
  const location=session.headers.get('Location');if(!location)throw Error('Drive no pudo iniciar la subida.');
  const file=await this.request(location,{method:'PUT',headers:{'Content-Type':'application/json'},body:content});return file.id;
 }
 async ensureFolder(){
  const q=new URLSearchParams({q:"trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='guarda' and value='folder-v1' }",fields:'files(id)',pageSize:'100'});
  const data=await this.request('files?'+q);if(data.files.length)return data.files.map(f=>f.id).sort()[0];
  const folder=await this.request('files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Guarda',mimeType:'application/vnd.google-apps.folder',appProperties:{guarda:'folder-v1'}})});return folder.id;
 }
}
