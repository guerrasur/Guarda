const plants=[['clover','Trébol'],['fern','Helecho'],['thistle','Cardo']];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function driveDescription(info){
 if(info?.connected)return info.state==='synced'?'Todo guardado en Google Drive. También tenés una copia local para usar sin conexión.':info.state==='error'?'No se pudo completar el guardado en Drive. Tus cambios se conservan en este dispositivo.':'Google Drive conectado. Hay cambios por sincronizar; se conservan en este dispositivo hasta completar el guardado.';
 if(info?.enabled)return 'Tu cuenta de Drive está vinculada. Reconectala para continuar la sincronización. Tus notas se conservan en este dispositivo.';
 return 'Tus notas se guardan en este dispositivo. Podés conectar Google Drive para sincronizarlas y exportar una copia desde Configuración.';
}
export function initProfile({store,drive,utility,closeUtility,showError,env=globalThis}){
 const $=id=>env.document.getElementById(id);let selected='clover',renderVersion=0;
 // Recover a legacy header left behind by an older cached document.
 const avatar=$('local-info');let image=$('profile-image');
 if(!image){image=avatar.querySelector('img')||env.document.createElement('img');image.id='profile-image';image.alt='';if(!image.parentNode)avatar.append(image);}
 let ring=$('drive-indicator');if(!ring){ring=env.document.createElement('span');ring.id='drive-indicator';ring.hidden=true;}
 ring.className='profile-ring';ring.setAttribute('role','status');ring.setAttribute('aria-live','polite');ring.textContent='';avatar.prepend(ring);avatar.setAttribute('aria-label','Perfil y Google Drive');
 async function render(){
  const version=++renderVersion;const value=await store.getSetting('profile-avatar','clover');if(version!==renderVersion)return;
  selected=plants.some(([id])=>id===value)?value:'clover';
  $('profile-image').src=`./avatars/${selected}.png`;
 }
 async function open(){
  await render();const info=drive.getState();
  utility('Tu perfil',`<p>Elegí tu foto de perfil</p><div class="profile-choices">${plants.map(([id,name])=>`<button class="profile-choice" data-avatar="${id}" aria-label="${name}" aria-pressed="${selected===id}"><img src="./avatars/${id}.png" alt=""><span>${name}</span></button>`).join('')}</div><p>${escape(driveDescription(info))}</p>${info.user?.emailAddress?`<p class="small">${escape(info.user.emailAddress)}</p>`:''}<button class="settings-action" id="profile-drive">${info.connected?'Administrar Google Drive':info.enabled?'Reconectar Google Drive':'Conectar Google Drive'}</button>`,[{label:'Listo',run:closeUtility}]);
  for(const button of env.document.querySelectorAll('[data-avatar]'))button.onclick=async()=>{
   try{await store.setSetting('profile-avatar',button.dataset.avatar);await render();for(const option of env.document.querySelectorAll('[data-avatar]'))option.setAttribute('aria-pressed',String(option.dataset.avatar===selected));}catch(error){showError(error);}
  };
  $('profile-drive').onclick=()=>{closeUtility();drive.open().catch(showError);};
 }
 $('local-info').onclick=()=>open().catch(showError);
 store.addEventListener('change',event=>{if(event.detail.id==='profile-avatar'||['cloud-apply','import'].includes(event.detail.type))render().catch(showError);});
 render().catch(showError);
 return {open,render};
}
