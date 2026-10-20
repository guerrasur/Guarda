import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';import {applyThemePreference} from '../src/theme.js';
const html=await readFile('index.html','utf8');const bootstrap=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(saved,systemDark){const {document}=parseHTML(html);const values=new Map(saved?[['guarda-theme',saved]]:[]);return {document,matchMedia:()=>({matches:systemDark}),localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};}
test('saved dark preference is applied in the head before body or application loading, even with a light system theme',()=>{
 const env=fixture('dark',false);vm.runInNewContext(bootstrap,env);assert.equal(env.document.documentElement.dataset.theme,'dark');assert.ok(html.indexOf('<script>')<html.indexOf('<link rel="stylesheet"'));assert.ok(html.indexOf('<script>')<html.indexOf('<body>'));
});
test('explicit light, system changes, initial migration and unavailable storage do not block rendering',()=>{
 for(const [saved,systemDark,expected] of [['light',true,'light'],['system',true,'dark'],['system',false,'light']]){const env=fixture(saved,systemDark);vm.runInNewContext(bootstrap,env);assert.equal(env.document.documentElement.dataset.theme,expected);}
 const env=fixture(null,false);vm.runInNewContext(bootstrap,env);assert.equal(env.document.documentElement.dataset.theme,undefined);applyThemePreference('dark',env);assert.equal(env.document.documentElement.dataset.theme,'dark');assert.equal(env.localStorage.getItem('guarda-theme'),'dark');assert.equal(env.document.querySelector('meta[name=theme-color]').content,'#202124');
 env.localStorage={getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}};vm.runInNewContext(bootstrap,env);applyThemePreference('light',env);assert.equal(env.document.documentElement.dataset.theme,'light');assert.equal(env.document.body.classList.contains('dark'),false);
});
