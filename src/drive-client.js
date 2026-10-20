export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const driveError=(message,code,extra={})=>Object.assign(new Error(message),{code,...extra});
export function driveFolderName(user){const username=(user?.emailAddress?.split('@')[0]||user?.permissionId||'usuario').replace(/[\\/:*?"<>|]/g,'-').slice(0,120);return 'GuardaNotes-'+username;}
const API='https://www.googleapis.com/drive/v3/';
export class DriveClient{
 constructor({env=globalThis,onStatus=()=>{}}={}){this.env=env;this.onStatus=onStatus;this.token=null;this.expires=0;this.user=null;this.oauth=null;this.pending=null;this.folder=null;this.identityVerified=false;}
 get folderName(){return driveFolderName(this.user);}
 get hasToken(){return !!this.token&&Date.now()<this.expires;}
 get connected(){return !this.pending&&this.hasToken&&!!this.user&&this.identityVerified;}
 session(clientId){return this.connected?{token:this.token,expires:this.expires,user:{...this.user},clientId}:null;}
 async restoreSession(session,{clientId,accountId}={}){
  if(!session||session.clientId!==clientId||!accountId||session.user?.permissionId!==accountId||typeof session.token!=='string'||!session.token||!Number.isFinite(session.expires)||session.expires<=Date.now()+15000)return false;
  this.token=session.token;this.expires=session.expires;this.identityVerified=false;
  await this.identify(accountId);return true;
 }
 async identify(accountId){
  const token=this.token;
  const data=await this.request('about?fields=user(permissionId,emailAddress,displayName),storageQuota');
  if(token!==this.token)throw driveError('La sesión cambió durante la conexión. Reintentá.','DRIVE_RETRYABLE');
  if(!data.user?.permissionId)throw driveError('Google no devolvió la cuenta. Se reintentará sin volver a pedir acceso.','DRIVE_RETRYABLE');
  if(accountId&&data.user.permissionId!==accountId){this.expire();this.user=null;this.folder=null;throw driveError('Estas notas están vinculadas a otra cuenta. Reconectá la cuenta anterior para evitar mezclarlas.','DRIVE_ACCOUNT');}
  this.user=data.user;this.identityVerified=true;this.folder=null;return this.user;
 }
 async prepare(clientId){
  if(!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))throw Error('Falta el ID de cliente OAuth de Guarda.');
  if(!this.env.google?.accounts?.oauth2){
   if(!this.loading)this.loading=new Promise((resolve,reject)=>{
    const script=this.env.document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;let done=false;
    const finish=error=>{if(done)return;done=true;this.env.clearTimeout(timer);if(error){script.remove();reject(error);}else resolve();};
    const timer=this.env.setTimeout(()=>finish(Error('No se pudo cargar la conexión con Google. Revisá internet y reintentá.')),20000);
    script.onload=()=>finish(this.env.google?.accounts?.oauth2?null:Error('Google no pudo inicializarse. Revisá la conexión y reintentá.'));
    script.onerror=()=>finish(Error('No se pudo cargar la conexión con Google. Revisá internet y reintentá.'));
    this.env.document.head.append(script);
   });
   const loading=this.loading;try{await loading;}finally{if(this.loading===loading)this.loading=null;}
  }
  this.oauthConfig={client_id:clientId,scope:DRIVE_SCOPE,include_granted_scopes:false};
  this.oauth=this.env.google.accounts.oauth2.initTokenClient({...this.oauthConfig,callback:()=>{}});
 }
 rejectAuthorization(error,pending=this.pending){
  if(!pending||pending!==this.pending)return;
  this.env.clearTimeout(pending.timer);this.pending=null;pending.reject(error);
 }
 connect({hint='',selectAccount=false,interactive=true,accountId=null}={}){
  if(!this.oauth)return Promise.reject(Error('Primero configurá la conexión con Google.'));
  if(this.pending)return Promise.reject(Error('La conexión con Google ya está en curso.'));
  return new Promise((resolve,reject)=>{
   const pending={resolve,reject,accountId};this.pending=pending;
   pending.timer=this.env.setTimeout(()=>this.rejectAuthorization(Error('Google no respondió. Volvé a tocar Reconectar; si no se abre la ventana, abrí Guarda en Safari o Chrome y permití las ventanas emergentes.'),pending),90000);
   try{
    // A fresh callback per attempt prevents a late popup from reviving a cancelled session.
    this.oauth=this.env.google.accounts.oauth2.initTokenClient({...this.oauthConfig,callback:response=>this.finishAuthorization(response,pending),error_callback:error=>this.rejectAuthorization(Error(error?.type==='popup_failed_to_open'?'No se pudo abrir Google. Permití las ventanas emergentes o abrí Guarda en Safari o Chrome y reintentá.':'Se cerró la ventana de Google. Podés volver a conectar.'),pending)});
    this.oauth.requestAccessToken({prompt:interactive?(selectAccount||!hint?'select_account':''):'none',...(hint?{login_hint:hint}:{})});
   }catch(error){this.rejectAuthorization(error,pending);}
  });
 }
 async finishAuthorization(response,pending=this.pending){
  if(!pending||pending!==this.pending)return;
  this.env.clearTimeout(pending.timer);
  try{
   if(['interaction_required','login_required','consent_required','account_selection_required'].includes(response.error))throw driveError('Google necesita tu confirmación. Tocá Reconectar Google Drive; tus cambios siguen guardados en este dispositivo.','DRIVE_INTERACTION');
   if(response.error||!response.access_token||!this.env.google.accounts.oauth2.hasGrantedAllScopes(response,DRIVE_SCOPE))throw Error(response.error==='access_denied'?'Google no autorizó la conexión. Reintentá con la cuenta vinculada; si aparece Error 403 access_denied, esa cuenta debe estar habilitada en el proyecto de Google.':'No se autorizó el acceso a los archivos de Guarda en Drive.');
   this.token=response.access_token;this.expires=Date.now()+Math.max(0,Number(response.expires_in||0)-60)*1000;this.identityVerified=false;
   const user=await this.identify(pending.accountId);
   if(pending!==this.pending)return;
   this.pending=null;pending.resolve(user);
  }catch(error){if(pending!==this.pending)return;if(error.code!=='DRIVE_RETRYABLE'&&!this.identityVerified)this.expire();this.rejectAuthorization(error,pending);}
 }
 expire(){this.token=null;this.expires=0;this.identityVerified=false;}
 disconnect(){this.expire();this.user=null;this.folder=null;this.rejectAuthorization(Error('Conexión cancelada. Podés volver a conectar.'));}
 async request(path,{method='GET',body,headers={},raw=false}={}){
  if(!this.token||Date.now()>=this.expires){this.expire();throw driveError('La sesión de Drive venció. Tocá Reconectar para renovarla; tus notas siguen guardadas localmente.','DRIVE_AUTH');}
  const url=path.startsWith('https://')?path:API+path;
  if(!url.startsWith(API)&&!url.startsWith('https://www.googleapis.com/upload/drive/v3/'))throw Error('Dirección de Drive no válida.');
  const token=this.token;const controller=new this.env.AbortController(),timer=this.env.setTimeout(()=>controller.abort(),120000);
  try{
   const response=await this.env.fetch(url,{method,headers:{...headers,Authorization:'Bearer '+token},body,signal:controller.signal,cache:'no-store'});
   if(response.status===401){if(token!==this.token)throw driveError('La sesión anterior venció. Se reintentará con la conexión actual.','DRIVE_RETRYABLE');this.expire();throw driveError('La sesión de Drive venció. Volvé a conectar tu cuenta.','DRIVE_AUTH');}
   if(!response.ok){let reason='';try{reason=(await response.json()).error?.errors?.[0]?.reason||'';}catch{}
    if(reason==='storageQuotaExceeded')throw Error('Tu cuenta de Drive no tiene espacio disponible. Tus cambios siguen guardados localmente.');
    if(response.status===429||response.status>=500||['rateLimitExceeded','userRateLimitExceeded','backendError'].includes(reason))throw driveError('Drive está ocupado. Se reintentará automáticamente; tus cambios siguen guardados en este dispositivo.','DRIVE_RETRYABLE',{retryAfterMs:Math.min(300000,Math.max(0,Number(response.headers.get('Retry-After'))||0)*1000)});
    if(response.status===404){this.folder=null;throw driveError('Un archivo o carpeta de Guarda cambió en Drive. Se volverá a comprobar la sincronización.','DRIVE_RETRYABLE');}
    if(response.status===403)throw driveError('Google Drive no autorizó esta operación. Revisá el acceso de Guarda a tu cuenta.','DRIVE_PERMISSION');
    throw Error('No se pudo completar la sincronización con Drive. Se conservaron tus cambios locales.');
   }
   if(raw)return response;return response.status===204?null:await response.json();
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw driveError(error.name==='AbortError'?'Drive tardó demasiado en responder. Se reintentará automáticamente.':'No se pudo acceder a Drive. Se reintentará al recuperar la conexión.','DRIVE_RETRYABLE');throw error;}finally{this.env.clearTimeout(timer);}
 }
 async listSnapshots(){
  const files=[];let pageToken='';
  do{const query=new URLSearchParams({q:"trashed = false and 'me' in owners and appProperties has { key='guarda' and value='sync-v1' }",fields:'nextPageToken,files(id,name,modifiedTime,appProperties,parents)',pageSize:'1000'});if(pageToken)query.set('pageToken',pageToken);const data=await this.request('files?'+query);files.push(...data.files);pageToken=data.nextPageToken||'';}while(pageToken);
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
 async ensureFolder({refresh=false}={}){
  if(refresh)this.folder=null;
  if(this.folder?.account===this.user?.permissionId)return this.folder.id;
  const q=new URLSearchParams({q:"trashed = false and 'me' in owners and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='guarda' and value='folder-v1' }",fields:'nextPageToken,files(id,name)',pageSize:'100'});
  const folders=[];let pageToken='';do{if(pageToken)q.set('pageToken',pageToken);const data=await this.request('files?'+q);folders.push(...data.files);pageToken=data.nextPageToken||'';}while(pageToken);
  const candidates=folders.filter(f=>typeof f.id==='string'&&f.id).sort((a,b)=>a.id.localeCompare(b.id));
  const existing=candidates.find(f=>f.name===this.folderName)||candidates[0];let id;
  if(existing){id=existing.id;if(existing.name!==this.folderName)await this.request('files/'+encodeURIComponent(id)+'?fields=id,name',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:this.folderName})});}
  else {const folder=await this.request('files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:this.folderName,mimeType:'application/vnd.google-apps.folder',appProperties:{guarda:'folder-v1'}})});id=folder.id;}
  if(!id)throw Error('Drive no devolvió la carpeta de Guarda.');this.folder={id,name:this.folderName,account:this.user?.permissionId};return id;
 }
 async placeSnapshot(file){
  const folder=await this.ensureFolder();const parents=file.parents||[];if(parents.includes(folder))return;
  const query=new URLSearchParams({addParents:folder,fields:'id,parents'});if(parents.length)query.set('removeParents',parents.join(','));
  await this.request('files/'+encodeURIComponent(file.id)+'?'+query,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'});
 }
}
