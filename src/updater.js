// Adapted from guerrasur/abridorsimuleitor/updater.js, with staged PWA updates.
export function newer(candidate,current){
 const valid=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
 if(!valid(candidate)||!valid(current))return false;
 const a=candidate.split('.').map(Number),b=current.split('.').map(Number);
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];
 return false;
}
export function initUpdater(current,{isBusy=()=>false,saveState=async()=>{},beforeReload=async()=>{},env=globalThis}={}){
 const {document,window,navigator,location,sessionStorage}=env;
 const message=document.getElementById('update-status'),button=document.getElementById('update');
 const banner=document.getElementById('update-banner'),notice=document.getElementById('update-notice'),accept=document.getElementById('update-accept');
 document.getElementById('version').textContent=`v${current}`;
 let registration,available=null,checking=false,applying=false,reloading=false,changed=false,requested=false,wasControlled=!!navigator.serviceWorker?.controller;
 const say=text=>{message.textContent=text;if(banner&&!banner.hidden)notice.textContent=text;};
 const announce=()=>{if(banner){banner.hidden=false;notice.textContent='Nueva actualización disponible'+(available?` (v${available.version})`:'')+'.';}};
 const key='guarda-update-attempt';
 const read=()=>{try{return sessionStorage.getItem(key);}catch{return null;}};
 const write=v=>{try{sessionStorage.setItem(key,v);}catch{}};
 if(read()===current){try{sessionStorage.removeItem(key);}catch{}}
 async function apply(){
  if(reloading||applying||!requested||(!available&&!changed)||document.hidden)return;
  if(isBusy()){say('Actualización lista. Se aplicará cuando cierres la nota o termines la operación.');return;}
  applying=true;
  try{
   await saveState();if(isBusy())return;
   if(changed){await beforeReload();if(isBusy())return;reloading=true;const url=new URL(location.href);if(available)url.searchParams.set('v',available.version);location.replace(url.href);return;}
   if(read()===available.version){say('La nueva versión todavía se está publicando. Volvé a actualizar en unos momentos.');return;}
   const worker=registration?.waiting;if(!worker){say('Preparando la actualización…');return;}
   const info=await new Promise((resolve,reject)=>{
    const channel=new env.MessageChannel();const timer=env.setTimeout(()=>{channel.port1.close();reject(new Error('Worker timeout'));},5000);
    channel.port1.onmessage=event=>{env.clearTimeout(timer);channel.port1.close();resolve(event.data);};
    worker.postMessage({type:'RELEASE_INFO'},[channel.port2]);
   });
   if(info.version!==available.version||info.build!==available.build){say('La nueva versión todavía se está publicando.');return;}
   if(isBusy())return;
   write(available.version);say('Actualizando…');worker.postMessage({type:'SKIP_WAITING'});
  }catch{say('No se pudo aplicar la actualización. Tus notas siguen guardadas.');}
  finally{applying=false;}
 }
 async function check(manual=false){
  if(checking||changed)return;checking=true;button.disabled=true;
  const controller=new env.AbortController(),timer=env.setTimeout(()=>controller.abort(),10000);
  try{
   if(manual){say('Buscando actualizaciones…');try{sessionStorage.removeItem(key);}catch{}}
   const url=new URL('./version.json',location.href);url.searchParams.set('t',Date.now());
   const response=await env.fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Version unavailable');
   const release=await response.json();if(!/^\d+\.\d+\.\d+$/.test(release.version)||!release.build)throw new Error('Invalid release');
   if(newer(release.version,current)){
    const fresh=available?.version!==release.version;available=release;if(fresh)announce();if(registration)await registration.update();await apply();
   }else if(manual)say(`Ya tenés la última versión (v${current}).`);
  }catch{if(manual)say('No se pudo buscar la actualización. Revisá la conexión.');}
  finally{env.clearTimeout(timer);checking=false;button.disabled=false;}
 }
 if(navigator.serviceWorker){
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(wasControlled){changed=true;if(!requested)announce();apply();}wasControlled=true;});
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
   registration=reg;
   const watch=()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')apply();});};
   reg.addEventListener('updatefound',watch);watch();check();
  }).catch(()=>say('No se pudo activar el modo sin conexión. Revisá la conexión.'));
 }else{button.disabled=true;say('Este navegador no admite actualizaciones sin conexión.');}
 const requestUpdate=async()=>{requested=true;if(changed)await apply();else await check(true);};
 button.addEventListener('click',()=>available||changed?requestUpdate():check(true));
 accept?.addEventListener('click',requestUpdate);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){apply();check();}});
 window.addEventListener('online',()=>check());
 env.setInterval(()=>{if(!document.hidden)check();},5*60*1000);
 env.setInterval(()=>apply(),1000);
 return {check,apply};
}
