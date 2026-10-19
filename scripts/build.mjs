import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { APP_VERSION } from '../src/version.js';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});await cp('src','dist/src',{recursive:true});
for(const f of ['index.html','manifest.webmanifest','sw.js'])await cp(f,`dist/${f}`);
const shell=['index.html','src/app.js','src/styles.css','src/icons.js','src/storage.js','src/recorder.js','src/viewport.js','src/updater.js','src/version.js','manifest.webmanifest','guardia-icon.png','favicon.ico','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png','icon-192.png','icon-512.png'];
// Version every script/style reference, including transitive imports. Old caches
// cannot provide modules from a different release during the first migration.
for(const f of shell.filter(f=>/\.(html|js)$/.test(f))){
 const text=await readFile(`dist/${f}`,'utf8');
 await writeFile(`dist/${f}`,text.replace(/(\.\/[^'"\s]+\.(?:js|css))(['"])/g,`$1?v=${APP_VERSION}$2`));
}
const hash=createHash('sha256');for(const f of shell)hash.update(await readFile(`dist/${f}`));
hash.update(await readFile('sw.js'));const build=hash.digest('hex').slice(0,16);
let sw=await readFile('dist/sw.js','utf8');sw=sw.replaceAll('GUARDA_BUILD_VERSION',build).replaceAll('GUARDA_APP_VERSION',APP_VERSION).replace(/(\.\/[^'"\s]+\.(?:js|css))(['"])/g,`$1?v=${APP_VERSION}$2`);
await writeFile('dist/sw.js',sw);
await writeFile('dist/version.json',JSON.stringify({version:APP_VERSION,build})+'\n');
console.log(`Guarda v${APP_VERSION}: dist/ listo (${build}).`);
