import { DriveClient } from './drive-client.js';
import { DriveSync } from './drive-sync.js';
import { GOOGLE_CLIENT_ID } from './drive-config.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initDrive({store,isBusy,onApplied,utility,closeUtility,showError,env=globalThis}){
 const $=id=>env.document.getElementById(id);let clientId=GOOGLE_CLIENT_ID,timer=null,remembered=null,enabled=false,message='Drive sin conectar',currentState='hidden',changeVersion=0;
 const indicator=(state,text)=>{currentState=state;const el=$('drive-indicator');if(!el)return;el.hidden=state==='hidden';el.dataset.state=state;el.title=text;el.setAttribute('aria-label',text);el.textContent='';const profile=$('local-info');if(profile){profile.title=text||'Perfil y Google Drive';profile.setAttribute('aria-label','Perfil. '+(text||'Google Drive sin conectar'));}};
 const status=text=>{message=text;for(const id of ['drive-status','drive-panel-status'])if($(id))$(id).textContent=text;};
 const client=new DriveClient({env});
 const sync=new DriveSync({store,client,isBusy,onApplied,env,onStatus:status});
 const queueRetry=()=>{env.clearTimeout(timer);timer=env.setTimeout(()=>attempt(),1500);};
 const defer=()=>{status('Google Drive conectado. Guardado pendiente; se reintentará al terminar la operación actual.');indicator('pending',message);queueRetry();return {deferred:true};};
 async function attempt(manual=false){
  if(!client.connected){if(enabled||client.user){status('Reconectá Google Drive para continuar el guardado en la nube. Tus notas están guardadas en este dispositivo.');indicator('error',message);}if(manual)throw Error(message);return;}
  if(isBusy())return defer();
  indicator('syncing','Sincronizando con Google Drive…');
  const started=changeVersion;
  try{const result=await sync.sync();if(started===changeVersion)indicator('synced','Todo guardado en Google Drive');else {indicator('pending','Cambios pendientes de guardar en Google Drive');queueRetry();}return result;}catch(error){if(['SYNC_DEFERRED','SYNC_LOCAL_CHANGED'].includes(error.code||error.cause?.code))return defer();status(error.message);indicator('error',error.message);if(manual)throw error;}
 }
 const schedule=()=>{changeVersion++;if(client.connected)indicator('pending','Cambios pendientes de guardar en Google Drive');env.clearTimeout(timer);timer=env.setTimeout(()=>attempt(),1500);};
 store.addEventListener('change',event=>{if(event.detail.type!=='cloud-apply'&&!event.detail.id?.startsWith('drive-'))schedule();});
 env.setInterval(()=>{if(!env.document.hidden)attempt();},60000);
 env.window.addEventListener('online',()=>attempt());env.document.addEventListener('visibilitychange',()=>{if(!env.document.hidden)attempt();});
 async function open(){
  clientId=await store.getSetting('drive-client-id',GOOGLE_CLIENT_ID);
  await ready;const connected=client.connected;
  utility('Google Drive',`<p>Cada persona guarda sus notas y audios en su propia cuenta de Drive. Los cambios sin conexión se conservan en este dispositivo.</p><p id="drive-panel-status" class="small" role="status">${escape(message)}</p>${client.user||remembered?`<p>${escape((client.user||remembered).emailAddress||(client.user||remembered).displayName||'Cuenta vinculada')}</p>`:''}<button class="settings-action" id="drive-connect" ${sync.running?'disabled':''}>${connected?'Renovar conexión con Google':enabled?'Reconectar Google Drive':'Conectar Google Drive'}</button><button class="settings-action" id="drive-sync-now" ${!connected||sync.running?'disabled':''}>Sincronizar ahora</button><button class="settings-action" id="drive-disconnect" ${(!client.user&&!enabled)||sync.running?'disabled':''}>Desconectar este dispositivo</button><p class="small">El permiso permite acceder a los archivos creados por Guarda. Al vencer la sesión, Google puede pedir que vuelvas a conectar. Desconectar conserva tus notas locales y tus archivos en Drive.</p><p class="small"><a href="./privacidad.html" target="_blank" rel="noopener">Privacidad y uso de los datos</a></p><details ${!clientId?'open':''}><summary>Configurar conexión de la app</summary><p class="small">La primera configuración requiere un ID de cliente OAuth web. Es público; no ingreses una contraseña ni un secreto.</p><label for="drive-client-id">ID de cliente de Google</label><input id="drive-client-id" class="popover-input" placeholder="123…apps.googleusercontent.com" value="${escape(clientId)}" autocomplete="off" spellcheck="false"><button class="settings-action" id="drive-save-client">Guardar configuración</button><p class="small">Origen autorizado: https://guerrasur.github.io</p></details>`,[{label:'Listo',run:closeUtility}]);
  const connect=$('drive-connect');connect.disabled=true;
  let prepared=false;
  const prepare=async()=>{prepared=false;connect.disabled=true;try{await client.prepare(clientId);prepared=true;}finally{if(connect.isConnected){connect.disabled=!!sync.running;connect.textContent=prepared?(client.connected?'Renovar conexión con Google':enabled?'Reconectar Google Drive':'Conectar Google Drive'):'Reintentar conexión con Google';}}};
  $('drive-save-client').onclick=async()=>{try{clientId=$('drive-client-id').value.trim();await prepare();await store.setSetting('drive-client-id',clientId);status('Configuración lista. Tocá Conectar Google Drive.');}catch(error){status(error.message);}};
  connect.onclick=()=>{
   if(!prepared){prepare().then(()=>status('Conexión lista. Tocá Conectar Google Drive.')).catch(error=>{status(error.message);showError(error);});return;}
   connect.disabled=true;status('Esperando autorización de Google…');
   client.connect({hint:(remembered||client.user)?.emailAddress||''}).then(async user=>{
    const bound=await store.getSetting('drive-bound-account',null);if(bound&&bound!==user.permissionId){client.disconnect();throw Error('Estas notas están vinculadas a otra cuenta. Reconectá la cuenta anterior para evitar mezclarlas.');}
    enabled=true;remembered={permissionId:user.permissionId,emailAddress:user.emailAddress,displayName:user.displayName};await store.setSetting('drive-connection',{enabled:true,user:remembered});
    closeUtility();status('Conectado a '+(user.emailAddress||user.displayName));await attempt(true);
   }).catch(error=>{status(error.message);showError(error);}).finally(()=>{if(connect.isConnected)connect.disabled=false;});
  };
  $('drive-sync-now').onclick=()=>{closeUtility();attempt(true).catch(showError);};
  $('drive-disconnect').onclick=async()=>{client.disconnect();enabled=false;remembered=null;await store.setSetting('drive-connection',{enabled:false});env.clearTimeout(timer);indicator('hidden','');status('Drive desconectado. Se conserva el guardado local.');closeUtility();};
  if(clientId)prepare().catch(error=>status(error.message));else status('Falta configurar el ID de cliente de Google para habilitar la conexión.');
 }
 const ready=(async()=>{const saved=await store.getSetting('drive-connection',null);const bound=await store.getSetting('drive-bound-account',null);if(saved?.enabled||(!saved&&bound)){enabled=true;remembered=saved?.user||null;await attempt();}})().catch(showError);
 return {open,markPending:schedule,resume:()=>{if(client.connected&&currentState==='pending')queueRetry();},getState:()=>({connected:client.connected,enabled,user:client.user||remembered,state:currentState,message}),sync:()=>attempt(true),isWorking:()=>!!sync.running||!!client.pending};
}
