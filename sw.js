const CACHE='guarda-shell-GUARDA_BUILD_VERSION';
const VERSION='GUARDA_APP_VERSION';
const BUILD='GUARDA_BUILD_VERSION';
const SHELL=['./','./index.html','./src/app.js','./src/keep-ui.js','./src/keep-import.js','./src/vendor/fflate.js','./src/drive-config.js','./src/cloud-merge.js','./src/drive-client.js','./src/drive-sync.js','./src/drive-ui.js','./src/styles.css','./src/icons.js','./src/storage.js','./src/recorder.js','./src/viewport.js','./src/note-drag.js','./src/updater.js','./src/version.js','./src/profile.js','./src/theme.js','./src/installation.js','./src/app-info.js','./src/attachments.js','./avatars/clover.png','./avatars/fern.png','./avatars/thistle.png','./manifest.webmanifest','./guardia-icon.svg','./favicon.svg','./favicon.ico','./favicon-16x16.png','./favicon-32x32.png','./apple-touch-icon.png','./icon-192.png','./icon-512.png'];
self.addEventListener('message',event=>{if(event.data?.type==='RELEASE_INFO')event.ports[0]?.postMessage({version:VERSION,build:BUILD});if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('install',event=>{event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // Bypass the browser HTTP cache when staging a release, including index.html.
 for(const path of SHELL){
  const url=new URL(path,self.registration.scope);const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw Error('No se pudo preparar '+path);
  if(path==='./index.html'&&!(await response.clone().text()).includes('name="guarda-version" content="'+VERSION+'"'))throw Error('La página todavía no corresponde a esta versión.');
  if(path.startsWith('./src/version.js')&&!(await response.clone().text()).includes("APP_VERSION = '"+VERSION+"'"))throw Error('La versión todavía se está publicando.');
  await cache.put(url,response);
 }
})());});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('guarda-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){const scopePath=new URL(self.registration.scope).pathname;if(![scopePath,scopePath+'index.html'].includes(url.pathname))return;event.respondWith(caches.open(CACHE).then(cache=>cache.match(new URL('./index.html',self.registration.scope))).then(cached=>cached||fetch(event.request)));return;}
 if(!SHELL.some(p=>new URL(p,self.registration.scope).href===url.href))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||fetch(event.request)));
});
