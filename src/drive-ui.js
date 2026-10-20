import { DriveSessionBridge } from './drive-session.js';
import { DriveClient, driveFolderName } from './drive-client.js';
import { DriveSync } from './drive-sync.js';
import { GOOGLE_CLIENT_ID } from './drive-config.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initDrive({store,isBusy,onApplied,utility,closeUtility,showError,env=globalThis}){
 const $=id=>env.document.getElementById(id);let clientId=GOOGLE_CLIENT_ID,timer=null,remembered=null,enabled=false,message='Drive sin conectar',currentState='hidden',changeVersion=0,flight=null,prepared=false,preparedId='',preparing=false,prepareFailed=false,backoff=3000,retryAt=0;
 const listeners=new Set();let prepareFlight=null,sessionCandidate=null;
 const bridge=new DriveSessionBridge({env});
 const client=new DriveClient({env});
 const getState=()=>({connected:client.connected,enabled,user:client.user||remembered,state:currentState,message,working:!!flight||!!client.pending,preparing,folder:client.folder,folderName:driveFolderName(client.user||remembered)});
 function controls(){
  const working=!!flight||!!sync.running||!!client.pending;
  if($('drive-save-client'))$('drive-save-client').disabled=preparing||working;
  if($('drive-connect')){const button=$('drive-connect');button.disabled=preparing||working;button.textContent=preparing?'Preparando conexión…':prepareFailed?'Reintentar conexión con Google':client.connected?'Renovar conexión con Google':enabled?'Reconectar Google Drive':'Conectar Google Drive';}
  if($('drive-sync-now'))$('drive-sync-now').disabled=!client.connected||working;
  if($('drive-disconnect'))$('drive-disconnect').disabled=(!client.user&&!enabled)||working;
  if($('drive-folder')){const link=$('drive-folder');link.hidden=!client.folder?.id;if(client.folder?.id)link.href='https://drive.google.com/drive/folders/'+encodeURIComponent(client.folder.id);}
  if($('drive-account'))$('drive-account').textContent=(client.connected?'Conectado a ': 'Cuenta vinculada: ')+((client.user||remembered)?.emailAddress||(client.user||remembered)?.displayName||'Google Drive');
 }
 const emit=()=>{controls();for(const listener of listeners)listener(getState());};
 const indicator=(state,text)=>{currentState=state;const el=$('drive-indicator');if(el){el.hidden=state==='hidden';el.dataset.state=state;el.title=text;el.setAttribute('aria-label',text);el.textContent='';}const profile=$('local-info');if(profile){profile.title=text||'Perfil y Google Drive';profile.setAttribute('aria-label','Perfil. '+(text||'Google Drive sin conectar'));}emit();};
 const status=text=>{message=text;for(const id of ['drive-status','drive-panel-status'])if($(id))$(id).textContent=text;emit();};
 const sync=new DriveSync({store,client,isBusy,onApplied,env,onStatus:status});
 const background=()=>attempt().catch(()=>{});
 const queueRetry=(delay=1500)=>{env.clearTimeout(timer);retryAt=Date.now()+delay;timer=env.setTimeout(()=>{timer=null;retryAt=0;return background();},delay);};
 function defer(retry=false){status('Google Drive conectado. Guardado pendiente; se reintentará al terminar la operación actual.');indicator('pending',message);if(retry)queueRetry();return {deferred:true};}
 function offline(){if(enabled||client.user){status('Sin conexión a internet. Tus cambios están guardados en este dispositivo y se enviarán cuando vuelva la conexión.');indicator('offline',message);}return {offline:true};}
 function attempt(manual=false){
  if(flight)return flight;
  if(!manual&&retryAt>Date.now())return Promise.resolve({scheduled:true});
  env.clearTimeout(timer);timer=null;retryAt=0;
  flight=runAttempt().finally(()=>{flight=null;emit();});emit();return flight;
 }
 async function rememberIdentity(user){
  const bound=await store.getSetting('drive-bound-account',null);
  if(bound&&bound!==user.permissionId){client.disconnect();sessionCandidate=null;await bridge.clear();throw Object.assign(Error('Estas notas están vinculadas a otra cuenta. Reconectá la cuenta anterior para evitar mezclarlas.'),{code:'DRIVE_ACCOUNT'});}
  if(!enabled||remembered?.permissionId!==user.permissionId||remembered?.emailAddress!==user.emailAddress){
   enabled=true;remembered={permissionId:user.permissionId,emailAddress:user.emailAddress,displayName:user.displayName};
   await store.setSetting('drive-connection',{enabled:true,user:remembered});
  }
 }
 async function runAttempt(){
  if(client.pending)return {deferred:true};
  if(env.navigator?.onLine===false)return offline();
  try{
   if(!client.connected&&sessionCandidate){
    status('Recuperando la conexión de Google Drive después de actualizar…');indicator('connecting',message);
    const accountId=await store.getSetting('drive-bound-account',remembered?.permissionId);
    const restored=await client.restoreSession(sessionCandidate,{clientId,accountId});
    sessionCandidate=null;if(restored)await rememberIdentity(client.user);
   }
   if(!client.connected&&client.hasToken){
    status('Comprobando la cuenta de Google Drive…');indicator('connecting',message);
    await client.identify(await store.getSetting('drive-bound-account',remembered?.permissionId));await rememberIdentity(client.user);
   }
   if(!client.connected){if(enabled||client.user){status('Tu cuenta sigue vinculada. Tocá Reconectar Google Drive para renovar el acceso; tus cambios locales están a salvo.');throw Object.assign(Error(message),{code:'DRIVE_AUTH'});}return;}
   if(isBusy())return defer();
   indicator('syncing','Sincronizando con Google Drive…');const started=changeVersion;
   const result=await sync.sync();if(env.navigator?.onLine===false)return offline();backoff=3000;
   if(started===changeVersion)indicator('synced','Todo guardado en Google Drive');else {indicator('pending','Cambios pendientes de guardar en Google Drive');queueRetry();}return result;
  }catch(error){
   const code=error.code||error.cause?.code;
   if(code==='DRIVE_RETRYABLE'&&env.navigator?.onLine===false)return offline();
   if(['SYNC_DEFERRED','SYNC_LOCAL_CHANGED'].includes(code))return defer(true);
   status(error.message);
   if(code==='DRIVE_RETRYABLE'){indicator('pending',message);queueRetry(Math.max(backoff,error.retryAfterMs||0));backoff=Math.min(backoff*2,60000);}
   else if(code==='DRIVE_AUTH'||!client.hasToken){sessionCandidate=null;indicator('reconnect',message);}
   else {env.clearTimeout(timer);timer=null;retryAt=0;indicator('error',message);}
   throw error;
  }
 }
 const schedule=()=>{changeVersion++;if(env.navigator?.onLine===false){offline();return;}if(client.connected){indicator('pending','Cambios pendientes de guardar en Google Drive');if(!retryAt)queueRetry();}else if(enabled)background();};
 store.addEventListener('change',event=>{if(event.detail.type!=='cloud-apply'&&event.detail.type!=='setting'&&!event.detail.id?.startsWith('drive-'))schedule();});
 const resume=()=>{if(client.connected&&currentState==='pending'&&!flight&&!retryAt)queueRetry();};
 env.setInterval(()=>{if(!env.document.hidden)background();},60000);
 env.window.addEventListener('online',()=>{backoff=3000;retryAt=0;env.clearTimeout(timer);background();});
 env.window.addEventListener('offline',()=>{env.clearTimeout(timer);timer=null;retryAt=0;changeVersion++;if(enabled){status('Sin conexión a internet. Tus cambios se conservan en este dispositivo.');indicator('offline',message);}});
 env.document.addEventListener('visibilitychange',()=>{if(!env.document.hidden)background();});
 env.document.addEventListener('close',resume,true);env.document.addEventListener('pause',resume,true);env.document.addEventListener('ended',resume,true);
 function prepare(){
  if(prepared&&preparedId===clientId)return Promise.resolve();if(prepareFlight)return prepareFlight;
  preparing=true;prepareFailed=false;prepared=false;emit();const requestedId=clientId;
  prepareFlight=client.prepare(requestedId).then(()=>{prepared=true;preparedId=requestedId;}).catch(error=>{prepareFailed=true;throw error;}).finally(()=>{preparing=false;prepareFlight=null;emit();});
  return prepareFlight;
 }
 function connect(){
  if(flight||client.pending)return Promise.resolve();
  if(!prepared)return open();
  env.clearTimeout(timer);timer=null;retryAt=0;status('Esperando autorización de Google…');
  // Keep requestAccessToken in the click stack; Safari requires a user gesture.
  const authorization=client.connect({hint:(remembered||client.user)?.emailAddress||''});indicator('connecting',message);
  return authorization.then(async user=>{
   await rememberIdentity(user);closeUtility();status('Conectado a '+(user.emailAddress||user.displayName));return attempt(true);
  }).catch(error=>{if(error.code==='DRIVE_RETRYABLE'){status(error.message);indicator('pending',message);if(!retryAt)queueRetry(backoff);throw error;}status(error.message);indicator(client.connected?'error':'reconnect',message);throw error;}).finally(emit);
 }
 async function open(){
  await ready;clientId=await store.getSetting('drive-client-id',GOOGLE_CLIENT_ID);const connected=client.connected;
  utility('Google Drive',`<p>Cada persona guarda sus notas y audios en su propia cuenta de Drive. Los cambios sin conexión se conservan en este dispositivo.</p><p id="drive-panel-status" class="small" role="status">${escape(message)}</p>${client.user||remembered?`<p id="drive-account">${escape((client.user||remembered).emailAddress||(client.user||remembered).displayName||'Cuenta vinculada')}</p>`:''}<p class="small">Carpeta: <b>${escape(driveFolderName(client.user||remembered))}</b></p><a id="drive-folder" class="settings-action" target="_blank" rel="noopener" hidden>Abrir carpeta en Drive</a><button class="settings-action" id="drive-connect" ${sync.running?'disabled':''}>${connected?'Renovar conexión con Google':enabled?'Reconectar Google Drive':'Conectar Google Drive'}</button><button class="settings-action" id="drive-sync-now" ${!connected||sync.running?'disabled':''}>Sincronizar ahora</button><button class="settings-action" id="drive-disconnect" ${(!client.user&&!enabled)||sync.running?'disabled':''}>Desconectar este dispositivo</button><p class="small">El permiso permite acceder a los archivos creados por Guarda. Al actualizar, Guarda intenta conservar el acceso vigente. Si la sesión vence o Google lo exige, podés renovar el acceso con la misma cuenta. Desconectar conserva tus notas locales y tus archivos en Drive.</p><p class="small"><a href="./privacidad.html" target="_blank" rel="noopener">Privacidad y uso de los datos</a></p><details ${!clientId?'open':''}><summary>Configurar conexión de la app</summary><p class="small">La primera configuración requiere un ID de cliente OAuth web. Es público; no ingreses una contraseña ni un secreto.</p><label for="drive-client-id">ID de cliente de Google</label><input id="drive-client-id" class="popover-input" placeholder="123…apps.googleusercontent.com" value="${escape(clientId)}" autocomplete="off" spellcheck="false"><button class="settings-action" id="drive-save-client">Guardar configuración</button><p class="small">Origen autorizado: https://guerrasur.github.io</p></details>`,[{label:'Listo',run:closeUtility}]);
  $('drive-save-client').onclick=async()=>{try{clientId=$('drive-client-id').value.trim();await prepare();await store.setSetting('drive-client-id',clientId);status('Configuración lista. Tocá Conectar Google Drive.');}catch(error){status(error.message);}};
  $('drive-connect').onclick=()=>{if(!prepared){prepare().then(()=>status('Conexión lista. Tocá Conectar Google Drive.')).catch(error=>{status(error.message);showError(error);});return;}connect().catch(showError);};
  $('drive-sync-now').onclick=()=>{closeUtility();attempt(true).catch(showError);};
  $('drive-disconnect').onclick=async()=>{if(flight||client.pending)return;client.disconnect();sessionCandidate=null;await bridge.clear();enabled=false;remembered=null;await store.setSetting('drive-connection',{enabled:false});env.clearTimeout(timer);timer=null;retryAt=0;backoff=3000;status('Drive desconectado. Se conserva el guardado local.');indicator('hidden','');closeUtility();};
  if((!prepared||preparedId!==clientId)&&!preparing&&clientId)prepare().catch(error=>status(error.message));else controls();
 }
 const ready=(async()=>{clientId=await store.getSetting('drive-client-id',GOOGLE_CLIENT_ID);const saved=await store.getSetting('drive-connection',null);const bound=await store.getSetting('drive-bound-account',null);if(saved?.enabled||(!saved&&bound)){enabled=true;remembered=saved?.user||null;prepare().catch(()=>{});sessionCandidate=await bridge.take();await background();}})().catch(showError);
 async function prepareReload(){
  await ready;if(!enabled||!client.connected)return false;
  if(currentState==='pending'&&env.navigator?.onLine!==false){try{await attempt(true);}catch{}}
  const session=client.session(clientId);return session?bridge.offer(session):false;
 }
 return {open,prepare,connect,prepareReload,markPending:schedule,resume,getState,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},sync:()=>attempt(true),isWorking:()=>!!flight||!!sync.running||!!client.pending};
}
