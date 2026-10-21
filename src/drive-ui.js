import { DriveSessionBridge } from './drive-session.js';
import { DriveClient, driveFolderName } from './drive-client.js';
import { PersistentDriveClient } from './drive-persistent.js';
import { DriveSync } from './drive-sync.js';
import { GOOGLE_CLIENT_ID, DRIVE_BROKER_URL } from './drive-config.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initDrive({store,isBusy,onApplied,utility,closeUtility,showError,env=globalThis,brokerUrl=DRIVE_BROKER_URL}){
 const $=id=>env.document.getElementById(id);let clientId=GOOGLE_CLIENT_ID,timer=null,remembered=null,enabled=false,message='Drive sin conectar',currentState='hidden',changeVersion=0,flight=null,prepared=false,preparedId='',preparing=false,prepareFailed=false,backoff=3000,retryAt=0;
 const listeners=new Set();let prepareFlight=null,sessionCandidate=null,renewalAttempted=false,initialized=false,boundAccount=null;
 const bridge=new DriveSessionBridge({env});
 const client=brokerUrl?new PersistentDriveClient({env,store,brokerUrl}):new DriveClient({env});
 const getState=()=>({connected:client.connected,enabled,user:client.user||remembered,state:currentState,message,working:!!flight||!!client.pending,preparing,folder:client.folder,folderName:driveFolderName(client.user||remembered)});
 function controls(){
  const working=!!flight||!!sync.running||!!client.pending;
  if($('drive-save-client'))$('drive-save-client').disabled=preparing||working;
  if($('drive-connect')){const button=$('drive-connect');button.disabled=preparing||working;button.textContent=preparing?'Preparando conexión…':prepareFailed?'Reintentar conexión con Google':client.connected?(client.persistent?'Revisar conexión':'Renovar conexión con Google'):enabled?'Reconectar Google Drive':'Conectar Google Drive';}
  if($('drive-sync-now'))$('drive-sync-now').disabled=!client.connected||working;
  if($('drive-disconnect'))$('drive-disconnect').disabled=(!client.user&&!enabled&&!client.pending)||!!flight||!!sync.running;
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
  const bound=await store.getSetting('drive-bound-account',null)||remembered?.permissionId;
  if(bound&&bound!==user.permissionId){await client.disconnect();sessionCandidate=null;await bridge.clear();throw Object.assign(Error('Estas notas están vinculadas a otra cuenta. Reconectá la cuenta anterior para evitar mezclarlas.'),{code:'DRIVE_ACCOUNT'});}
  if(!enabled||remembered?.permissionId!==user.permissionId||remembered?.emailAddress!==user.emailAddress){
   enabled=true;remembered={permissionId:user.permissionId,emailAddress:user.emailAddress,displayName:user.displayName};
   await store.setSetting('drive-connection',{enabled:true,user:remembered});
  }
  boundAccount=bound||user.permissionId;renewalAttempted=false;
 }
 async function runAttempt(){
  if(client.pending)return {deferred:true};
  if(env.navigator?.onLine===false)return offline();
  try{
   if(client.persistent&&enabled&&!client.connected){
    status('Recuperando la conexión de Google Drive…');indicator('connecting',message);
    if(await client.resumeSession({clientId,accountId:boundAccount||remembered?.permissionId}))await rememberIdentity(client.user);
   }
   if(!client.connected&&sessionCandidate){
    status('Recuperando la conexión de Google Drive…');indicator('connecting',message);
    const accountId=await store.getSetting('drive-bound-account',remembered?.permissionId);
    const restored=await client.restoreSession(sessionCandidate,{clientId,accountId});
    sessionCandidate=null;if(restored)await rememberIdentity(client.user);
   }
   if(!client.connected&&client.hasToken){
    status('Comprobando la cuenta de Google Drive…');indicator('connecting',message);
    await client.identify(await store.getSetting('drive-bound-account',remembered?.permissionId));await rememberIdentity(client.user);
   }
   if(!client.connected){
    if(!enabled&&!client.user)return;
    if(!prepared||preparedId!==clientId){
     try{await prepare();}catch(error){throw Object.assign(Error(error.message),{code:'DRIVE_RETRYABLE'});}
    }
    const text=client.persistent?'Conectá Google Drive una vez para activar la conexión automática. Tus notas siguen guardadas en este dispositivo.':renewalAttempted||!remembered?.emailAddress?'Tu cuenta sigue vinculada. Tocá Reconectar Google Drive para renovar el acceso; tus cambios están guardados en este dispositivo.':'Tu cuenta sigue vinculada. Guarda intentará recuperar el acceso al interactuar con el tablero. También podés usar Reconectar Google Drive.';
    status(text);indicator('reconnect',text);return {needsAuthorization:true};
   }
   preserveSession();
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
   else if(code==='DRIVE_AUTH'||code==='DRIVE_ACCOUNT'||!client.hasToken){sessionCandidate=null;await bridge.clear();indicator('reconnect',message);}
   else {env.clearTimeout(timer);timer=null;retryAt=0;indicator('error',message);}
   throw error;
  }
 }
 const schedule=()=>{changeVersion++;if(env.navigator?.onLine===false){offline();return;}if(client.connected){indicator('pending','Cambios pendientes de guardar en Google Drive');if(!retryAt)queueRetry();}else if(enabled)background();};
 store.addEventListener('change',event=>{if(event.detail.type!=='cloud-apply'&&event.detail.type!=='setting'&&!event.detail.id?.startsWith('drive-'))schedule();});
 const resume=()=>{if(client.connected&&currentState==='pending'&&!flight&&!retryAt)queueRetry();};
 env.setInterval(()=>{if(!env.document.hidden)background();},60000);
 env.window.addEventListener('online',()=>{backoff=3000;retryAt=0;env.clearTimeout(timer);client.flushRevocations?.().catch(()=>{});background();});
 env.window.addEventListener('offline',()=>{env.clearTimeout(timer);timer=null;retryAt=0;changeVersion++;if(enabled){status('Sin conexión a internet. Tus cambios se conservan en este dispositivo.');indicator('offline',message);}});
 function preserveSession(){const session=enabled&&client.session(clientId);if(session)bridge.offer(session).catch(()=>{});}
 env.document.addEventListener('visibilitychange',()=>{if(!env.document.hidden)background();else preserveSession();});
 env.window.addEventListener('pagehide',preserveSession);
 env.window.addEventListener('pageshow',event=>{if(event.persisted)background();});
 // A click is handled after the target's action, so opening an editor or
 // dialog can block renewal. Never hijack editing, media, drag or controls.
 // prompt:none only recovers existing consent; interactive login is explicit.
 function renewOnInteraction(event){
  if(client.persistent)return;
  if(!event.isTrusted||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||(event.button!==undefined&&event.button!==0))return;
  if(!initialized||!enabled||!remembered?.emailAddress||client.hasToken||client.pending||flight||!prepared||renewalAttempted||sessionCandidate||isBusy()||env.navigator?.onLine===false||env.document.hidden||env.navigator?.userActivation?.isActive===false)return;
  if(event.target?.closest?.('button,a,input,select,textarea,label,[role="button"],[contenteditable],dialog,audio,video,canvas,[draggable="true"],[data-note],[data-action]'))return;
  connect({automatic:true}).catch(()=>{});
 }
 env.document.addEventListener('click',renewOnInteraction);
 env.document.addEventListener('close',resume,true);env.document.addEventListener('pause',resume,true);env.document.addEventListener('ended',resume,true);
 function prepare(){
  if(prepared&&preparedId===clientId)return Promise.resolve();if(prepareFlight)return prepareFlight;
  preparing=true;prepareFailed=false;prepared=false;emit();const requestedId=clientId;
  prepareFlight=client.prepare(requestedId).then(()=>{prepared=true;preparedId=requestedId;}).catch(error=>{prepareFailed=true;throw error;}).finally(()=>{preparing=false;prepareFlight=null;emit();});
  return prepareFlight;
 }
 function connect({automatic=false}={}){
  if(flight||client.pending)return Promise.resolve();
  if(!prepared)return open();
  renewalAttempted=true;
  env.clearTimeout(timer);timer=null;retryAt=0;status('Esperando autorización de Google…');
  // Keep requestAccessToken in the click stack; Safari requires a user gesture.
  const authorization=client.connect({hint:(remembered||client.user)?.emailAddress||'',interactive:!automatic,accountId:boundAccount||remembered?.permissionId});indicator('connecting',message);
  return authorization.then(async user=>{
   await rememberIdentity(user);preserveSession();status('Conectado a '+(user.emailAddress||user.displayName));return attempt(true);
  }).catch(async error=>{if(error.code==='DRIVE_RETRYABLE'){status(error.message);indicator('pending',message);if(!retryAt)queueRetry(backoff);throw error;}if(!client.hasToken){sessionCandidate=null;await bridge.clear();}status(error.message);indicator(client.connected?'error':'reconnect',message);throw error;}).finally(emit);
 }
 async function open(){
  await ready;clientId=await store.getSetting('drive-client-id',GOOGLE_CLIENT_ID);const connected=client.connected;
  utility('Google Drive',`<p>Cada persona guarda sus notas y audios en su propia cuenta de Drive. Los cambios sin conexión se conservan en este dispositivo.</p><p id="drive-panel-status" class="small" role="status">${escape(message)}</p>${client.user||remembered?`<p id="drive-account">${escape((client.user||remembered).emailAddress||(client.user||remembered).displayName||'Cuenta vinculada')}</p>`:''}<p class="small">Carpeta: <b>${escape(driveFolderName(client.user||remembered))}</b></p><a id="drive-folder" class="settings-action" target="_blank" rel="noopener" hidden>Abrir carpeta en Drive</a><button class="settings-action" id="drive-connect" ${sync.running?'disabled':''}>${connected?'Renovar conexión con Google':enabled?'Reconectar Google Drive':'Conectar Google Drive'}</button><button class="settings-action" id="drive-sync-now" ${!connected||sync.running?'disabled':''}>Sincronizar ahora</button><button class="settings-action" id="drive-disconnect" ${(!client.user&&!enabled)||sync.running?'disabled':''}>Desconectar este dispositivo</button><p class="small">${client.persistent?'Conectá una vez para activar el guardado automático en Drive. Guarda recupera la conexión al abrirse, actualizarse o volver a tener internet. Google puede pedir autorización nuevamente si revocás el permiso. Desconectar conserva tus notas locales y tus archivos en Drive.':'El permiso permite acceder a los archivos creados por Guarda. Al volver a abrir o actualizar, Guarda intenta recuperar el acceso vigente y sincronizar automáticamente. Si falta el acceso, intenta recuperarlo al tocar una zona libre del tablero. Si Google requiere confirmación, usá Reconectar Google Drive. Al cerrar la app, el navegador puede descartar la sesión. Desconectar conserva tus notas locales y tus archivos en Drive.'}</p><p class="small"><a href="./privacidad.html" target="_blank" rel="noopener">Privacidad y uso de los datos</a></p><details ${client.persistent?'hidden':''} ${!clientId?'open':''}><summary>Configurar conexión de la app</summary><p class="small">La primera configuración requiere un ID de cliente OAuth web. Es público; no ingreses una contraseña ni un secreto.</p><label for="drive-client-id">ID de cliente de Google</label><input id="drive-client-id" class="popover-input" placeholder="123…apps.googleusercontent.com" value="${escape(clientId)}" autocomplete="off" spellcheck="false"><button class="settings-action" id="drive-save-client">Guardar configuración</button><p class="small">Origen autorizado: https://guerrasur.github.io</p></details>`,[{label:'Listo',run:closeUtility}]);
  $('drive-save-client').onclick=async()=>{try{clientId=$('drive-client-id').value.trim();await prepare();await store.setSetting('drive-client-id',clientId);status('Configuración lista. Tocá Conectar Google Drive.');}catch(error){status(error.message);}};
  $('drive-connect').onclick=()=>{if(client.persistent&&client.connected){attempt(true).catch(showError);return;}if(!prepared){prepare().then(()=>status('Conexión lista. Tocá Conectar Google Drive.')).catch(error=>{status(error.message);showError(error);});return;}closeUtility();connect().catch(showError);};
  $('drive-sync-now').onclick=()=>{closeUtility();attempt(true).catch(showError);};
  $('drive-disconnect').onclick=async()=>{if(flight||sync.running)return;enabled=false;remembered=null;renewalAttempted=true;const disconnected=client.disconnect();sessionCandidate=null;env.clearTimeout(timer);timer=null;retryAt=0;backoff=3000;await store.setSetting('drive-connection',{enabled:false});await disconnected;await bridge.clear();status('Drive desconectado. Se conserva el guardado local.');indicator('hidden','');closeUtility();};
  if((!prepared||preparedId!==clientId)&&!preparing&&clientId)prepare().catch(error=>status(error.message));else controls();
 }
 const ready=(async()=>{clientId=await store.getSetting('drive-client-id',GOOGLE_CLIENT_ID);client.flushRevocations?.().catch(()=>{});const saved=await store.getSetting('drive-connection',null);boundAccount=await store.getSetting('drive-bound-account',null);if(saved?.enabled||(!saved&&boundAccount)){enabled=true;remembered=saved?.user||null;sessionCandidate=client.persistent?null:await bridge.take();await background();}initialized=true;})().catch(showError);
 async function prepareReload(){
  await ready;if(!enabled||!client.connected)return false;
  if(currentState==='pending'&&env.navigator?.onLine!==false){try{await attempt(true);}catch{}}
  const session=client.session(clientId);return session?bridge.offer(session):false;
 }
 return {open,prepare,connect,prepareReload,markPending:schedule,resume,getState,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},sync:()=>attempt(true),isWorking:()=>!!flight||!!sync.running||!!client.pending};
}
