import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {initInstallState} from '../src/installation.js';
function fixture({ios=false,standalone=false}={}){
 const {document,window}=parseHTML('<html><button id="install-button"></button></html>');const modes=[];let notices=0;
 const env={document,window,navigator:{standalone:ios},matchMedia:query=>{const mode={matches:standalone&&query.includes(': standalone)'),addEventListener:(_,fn)=>mode.change=fn};modes.push(mode);return mode;}};
 const ui=initInstallState({env,onInstalled:()=>notices++});return {document,window,ui,modes,get notices(){return notices;}};
}
test('installed iOS and standalone apps hide installation in both the sidebar and newly opened settings',()=>{
 for(const options of [{ios:true},{standalone:true}]){const f=fixture(options);assert.equal(f.document.getElementById('install-button').hidden,true);const settings=f.document.createElement('button');settings.id='install-settings';f.document.documentElement.append(settings);f.ui.refresh();assert.equal(settings.hidden,true);}
});
test('browser installation event and display changes refresh visibility without a permanent installation flag',()=>{
 const f=fixture();assert.equal(f.document.getElementById('install-button').hidden,false);f.modes[0].matches=true;f.modes[0].change();assert.equal(f.document.getElementById('install-button').hidden,true);f.modes[0].matches=false;f.modes[0].change();assert.equal(f.document.getElementById('install-button').hidden,false);
 f.window.dispatchEvent(new f.window.Event('appinstalled'));assert.equal(f.document.getElementById('install-button').hidden,true);assert.equal(f.notices,1);assert.equal(fixture().ui.isInstalled(),false);
});
