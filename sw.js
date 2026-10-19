const CACHE='guarda-shell-GUARDA_BUILD_VERSION';
const SHELL=['./','./index.html','./src/app.js','./src/styles.css','./src/icons.js','./src/storage.js','./src/recorder.js','./src/viewport.js','./manifest.webmanifest','./guardia-icon.png','./favicon.ico','./favicon-16x16.png','./favicon-32x32.png','./apple-touch-icon.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('guarda-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./index.html',self.registration.scope))));return;}
 if(!SHELL.some(p=>new URL(p,self.registration.scope).href===url.href))return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
