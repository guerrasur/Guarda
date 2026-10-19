import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});await cp('src','dist/src',{recursive:true});
for(const f of ['index.html','manifest.webmanifest','sw.js'])await cp(f,`dist/${f}`);
const shell=['index.html','src/app.js','src/styles.css','src/icons.js','src/storage.js','src/recorder.js','manifest.webmanifest','guardia-icon.png','favicon.ico','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png','icon-192.png','icon-512.png'];
const hash=createHash('sha256');for(const f of shell)hash.update(await readFile(`dist/${f}`));
const sw=await readFile('dist/sw.js','utf8');await writeFile('dist/sw.js',sw.replace('GUARDA_BUILD_VERSION',hash.digest('hex').slice(0,16)));
console.log('Guarda: dist/ listo (app estática, sin servicios de nube).');
