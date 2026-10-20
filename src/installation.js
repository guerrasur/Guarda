export function initInstallState({env=globalThis,onInstalled=()=>{}}={}){
 const modes=['standalone','minimal-ui'].map(mode=>env.matchMedia(`(display-mode: ${mode})`));
 let installedHere=false;
 const isInstalled=()=>installedHere||env.navigator.standalone===true||modes.some(mode=>mode.matches);
 const refresh=()=>{for(const id of ['install-button','install-settings']){const button=env.document.getElementById(id);if(button)button.hidden=isInstalled();}};
 for(const mode of modes)mode.addEventListener?.('change',refresh);
 env.window.addEventListener('appinstalled',()=>{installedHere=true;refresh();onInstalled();});
 env.document.addEventListener('visibilitychange',refresh);
 refresh();return {isInstalled,refresh};
}
