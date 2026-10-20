import { DriveClient } from './drive-client.js';
import { DriveSync } from './drive-sync.js';
import { GOOGLE_CLIENT_ID } from './drive-config.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initDrive({store,isBusy,onApplied,utility,closeUtility,showError,env=globalThis}){
 const $=id=>env.document.getElementById(id);let clientId=GOOGLE_CLIENT_ID,timer=null,message='Drive sin conectar';
 const indicator=(state,text)=>{const el=$('drive-indicator');if(!el)return;el.hidden=state==='hidden';el.dataset.state=state;el.title=text;el.setAttribute('aria-label',text);el.textContent=state==='synced'?'✓':state==='error'?'!':'';};
 const status=text=>{message=text;for(const id of ['drive-status','drive-panel-status'])if($(id))$(id).textContent=text;};
 const client=new DriveClient({env});
 const sync=new DriveSync({store,client,isBusy,onApplied,env,onStatus:status});
 async function attempt(manual=false){
  if(!client.connected){if(client.user){status('La sesión de Drive venció. Volvé a conectar.');indicator('error',message);}return;}
  if(isBusy()){if(manual)throw Error('Cerrá la nota o terminá la operación antes de sincronizar.');return;}
  indicator('syncing','Sincronizando con Google Drive…');
  try{const result=await sync.sync();indicator('synced','Todo guardado en Google Drive');return result;}catch(error){status(error.message);indicator('error',error.message);if(manual)throw error;}
 }
 const schedule=()=>{if(client.connected)indicator('pending','Cambios pendientes de guardar en Google Drive');env.clearTimeout(timer);timer=env.setTimeout(()=>attempt(),1500);};
 store.addEventListener('change',event=>{if(event.detail.type!=='cloud-apply'&&!event.detail.id?.startsWith('drive-'))schedule();});
 env.setInterval(()=>{if(!env.document.hidden)attempt();},60000);
 env.window.addEventListener('online',()=>attempt());env.document.addEventListener('visibilitychange',()=>{if(!env.document.hidden)attempt();});
 async function open(){
  clientId=await store.getSetting('drive-client-id',GOOGLE_CLIENT_ID);
  const connected=client.connected;
  utility('Google Drive',`<p>Cada persona guarda sus notas y audios en su propia cuenta de Drive. Los cambios sin conexión se conservan en este dispositivo.</p><p id="drive-panel-status" class="small" role="status">${escape(message)}</p>${client.user?`<p>${escape(client.user.emailAddress||client.user.displayName)}</p>`:''}<button class="settings-action" id="drive-connect" ${sync.running?'disabled':''}>${connected?'Renovar conexión con Google':'Conectar Google Drive'}</button><button class="settings-action" id="drive-sync-now" ${!connected||sync.running?'disabled':''}>Sincronizar ahora</button><button class="settings-action" id="drive-disconnect" ${!client.user||sync.running?'disabled':''}>Desconectar este dispositivo</button><p class="small">El permiso permite acceder a los archivos creados por Guarda. Al vencer la sesión, Google puede pedir que vuelvas a conectar. Desconectar conserva tus notas locales y tus archivos en Drive.</p><p class="small"><a href="./privacidad.html" target="_blank" rel="noopener">Privacidad y uso de los datos</a></p><details ${!clientId?'open':''}><summary>Configurar conexión de la app</summary><p class="small">La primera configuración requiere un ID de cliente OAuth web. Es público; no ingreses una contraseña ni un secreto.</p><label for="drive-client-id">ID de cliente de Google</label><input id="drive-client-id" class="popover-input" placeholder="123…apps.googleusercontent.com" value="${escape(clientId)}" autocomplete="off" spellcheck="false"><button class="settings-action" id="drive-save-client">Guardar configuración</button><p class="small">Origen autorizado: https://guerrasur.github.io</p></details>`,[{label:'Listo',run:closeUtility}]);
  const connect=$('drive-connect');connect.disabled=true;
  const prepare=async()=>{connect.disabled=true;await client.prepare(clientId);if(connect.isConnected)connect.disabled=!!sync.running;};
  $('drive-save-client').onclick=async()=>{try{clientId=$('drive-client-id').value.trim();await prepare();await store.setSetting('drive-client-id',clientId);status('Configuración lista. Tocá Conectar Google Drive.');}catch(error){status(error.message);}};
  connect.onclick=()=>{
   connect.disabled=true;status('Esperando autorización de Google…');
   client.connect().then(async user=>{
    const bound=await store.getSetting('drive-bound-account',null);if(bound&&bound!==user.permissionId){client.disconnect();throw Error('Estas notas están vinculadas a otra cuenta. Reconectá la cuenta anterior para evitar mezclarlas.');}
    closeUtility();status('Conectado a '+(user.emailAddress||user.displayName));await attempt(true);
   }).catch(error=>{status(error.message);showError(error);}).finally(()=>{if(connect.isConnected)connect.disabled=false;});
  };
  $('drive-sync-now').onclick=()=>{closeUtility();attempt(true).catch(showError);};
  $('drive-disconnect').onclick=()=>{client.disconnect();env.clearTimeout(timer);indicator('hidden','');status('Drive desconectado. Se conserva el guardado local.');closeUtility();};
  if(clientId)prepare().catch(error=>status(error.message));else status('Falta configurar el ID de cliente de Google para habilitar la conexión.');
 }
 return {open,sync:()=>attempt(true),isWorking:()=>!!sync.running||!!client.pending};
}
