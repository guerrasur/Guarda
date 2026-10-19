import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFile,access} from 'node:fs/promises';import {APP_VERSION} from '../src/version.js';
test('production release versions every module/style and stages exactly the shipped shell',async()=>{
 execFileSync(process.execPath,['scripts/build.mjs']);
 const release=JSON.parse(await readFile('dist/version.json'));assert.equal(release.version,APP_VERSION);assert.match(release.build,/^[a-f0-9]{16}$/);
 const html=await readFile('dist/index.html','utf8'),sw=await readFile('dist/sw.js','utf8');assert.match(html,new RegExp(`v${APP_VERSION.replaceAll('.','\\.')}`));assert.ok(sw.includes(`const VERSION='${APP_VERSION}'`));assert.ok(sw.includes(`const BUILD='${release.build}'`));assert.doesNotMatch(sw,/GUARDA_(APP|BUILD)_VERSION/);
 const files=JSON.parse(sw.match(/const SHELL=(\[.*?\]);/)[1].replaceAll("'",'"'));
 for(const file of files){const url=new URL(file,'https://example.test/Guarda/');if(url.pathname==='/Guarda/')continue;const path='dist/'+url.pathname.replace('/Guarda/','');await access(path);if(/\.(js|css)$/.test(url.pathname))assert.equal(url.searchParams.get('v'),APP_VERSION);if(path.endsWith('.js')){const source=await readFile(path,'utf8');for(const match of source.matchAll(/from ['"](.+?)['"]/g)){const dep=new URL(match[1],url);assert.equal(dep.searchParams.get('v'),APP_VERSION);assert.ok(files.some(f=>new URL(f,'https://example.test/Guarda/').href===dep.href));}}}
});
