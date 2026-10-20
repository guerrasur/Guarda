import test from 'node:test';import assert from 'node:assert/strict';import {DriveClient,DRIVE_SCOPE} from '../src/drive-client.js';
function setup(){let config,mode='success';const requests=[];let fetcher=async()=>new Response(JSON.stringify({user:{permissionId:'owner',emailAddress:'owner@example.test'}}),{status:200,headers:{'Content-Type':'application/json'}});
 const env={AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},google:{accounts:{oauth2:{hasGrantedAllScopes:r=>r.scope===DRIVE_SCOPE,initTokenClient:cfg=>{assert.equal(typeof cfg.callback,'function');config=cfg;return {requestAccessToken:()=>queueMicrotask(()=>{if(mode==='closed')cfg.error_callback({type:'popup_closed'});else cfg.callback(mode==='denied'?{error:'access_denied'}:{access_token:'test-token',expires_in:3600,scope:DRIVE_SCOPE});})};}}}}};
 const client=new DriveClient({env});return {client,requests,mode:value=>mode=value,fetch:fn=>fetcher=fn,config:()=>config};
}
const id='123456-publicclient.apps.googleusercontent.com';
test('OAuth requests only drive.file, identifies the owner and keeps tokens only in memory',async()=>{const f=setup();await f.client.prepare(id);assert.equal(f.config().scope,DRIVE_SCOPE);assert.equal(f.config().include_granted_scopes,false);const user=await f.client.connect();assert.equal(user.permissionId,'owner');assert.equal(f.client.connected,true);assert.equal(f.requests[0].options.headers.Authorization,'Bearer test-token');f.client.disconnect();assert.equal(f.client.connected,false);assert.equal(f.client.token,null);});
test('closed consent window and denied consent can be retried without a stuck login',async()=>{const f=setup();await f.client.prepare(id);for(const mode of ['closed','denied']){f.mode(mode);await assert.rejects(f.client.connect());assert.equal(f.client.pending,null);assert.equal(f.client.connected,false);}f.mode('success');await f.client.connect();assert.equal(f.client.connected,true);});
test('expired sessions and non-Google upload URLs never transmit tokens or data',async()=>{const f=setup();await f.client.prepare(id);await f.client.connect();const count=f.requests.length;await assert.rejects(f.client.request('https://attacker.example/upload'),/Dirección/);assert.equal(f.requests.length,count);f.client.expires=0;await assert.rejects(f.client.request('files'),/venció/);assert.equal(f.requests.length,count);assert.equal(f.client.token,null);});
test('resumable upload labels the app file and sends JSON only to the Google upload endpoint',async()=>{const f=setup();await f.client.prepare(id);await f.client.connect();f.fetch(async(url,options)=>{if(url.includes('uploadType=resumable'))return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'}});if(options.method==='PUT'){assert.equal(await options.body.text(),'{"records":[]}');return Response.json({id:'saved'});}if(url.includes('files?')&&options.method==='GET')return Response.json({files:[{id:'folder',name:'GuardaNotes-owner'}]});throw Error('Unexpected request');});const result=await f.client.writeSnapshot('device',{records:[]});assert.equal(result,'saved');const session=f.requests.find(r=>r.url.includes('uploadType=resumable'));assert.equal(JSON.parse(session.options.body).appProperties.guarda,'sync-v1');assert.deepEqual(JSON.parse(session.options.body).parents,['folder']);});
test('Drive list follows pagination and reports quota failures without discarding local session',async()=>{const f=setup();await f.client.prepare(id);await f.client.connect();f.fetch(async url=>Response.json(url.includes('pageToken=next')?{files:[{id:'second'}]}:{files:[{id:'first'}],nextPageToken:'next'}));assert.deepEqual((await f.client.listSnapshots()).map(r=>r.id),['first','second']);f.fetch(async()=>new Response(JSON.stringify({error:{errors:[{reason:'storageQuotaExceeded'}]}}),{status:403}));await assert.rejects(f.client.listSnapshots(),/espacio disponible/);assert.equal(f.client.connected,true);});
test('expired and rejected tokens keep the account identity available for reconnection',async()=>{
 const f=setup();await f.client.prepare(id);await f.client.connect();f.client.expires=0;await assert.rejects(f.client.request('files'),/venció/);assert.equal(f.client.user.emailAddress,'owner@example.test');assert.equal(f.client.token,null);await f.client.connect({hint:f.client.user.emailAddress});assert.equal(f.client.connected,true);
 f.fetch(async()=>new Response(null,{status:401}));await assert.rejects(f.client.request('files'),/venció/);assert.equal(f.client.user.permissionId,'owner');f.client.disconnect();assert.equal(f.client.user,null);
});
test('a timed out or cancelled authorization can be retried and late callbacks are ignored',async()=>{
 let config;const timers=new Map();let seq=0;
 const env={setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),google:{accounts:{oauth2:{initTokenClient:cfg=>{assert.equal(typeof cfg.callback,'function');config=cfg;return {requestAccessToken(){}};}}}}};
 const client=new DriveClient({env});await client.prepare(id);const first=client.connect();const old=config;const rejected=assert.rejects(first,/Google no respondió/);[...timers.values()][0]();await rejected;assert.equal(client.pending,null);
 const second=client.connect();const cancelled=assert.rejects(second,/cancelada/);await old.callback({access_token:'late'});assert.equal(client.token,null);assert.ok(client.pending);client.disconnect();await cancelled;assert.equal(timers.size,0);
});
test('Drive distinguishes temporary limits, missing files, network failures, denied permissions and expired authorization',async()=>{
 const f=setup();await f.client.prepare(id);await f.client.connect();
 for(const [status,reason,code] of [[429,'','DRIVE_RETRYABLE'],[503,'','DRIVE_RETRYABLE'],[403,'userRateLimitExceeded','DRIVE_RETRYABLE'],[404,'','DRIVE_RETRYABLE'],[403,'insufficientPermissions','DRIVE_PERMISSION']]){
  f.fetch(async()=>Response.json({error:{errors:[{reason}]}},{status,headers:{'Retry-After':'12'}}));await assert.rejects(f.client.listSnapshots(),error=>error.code===code);assert.equal(f.client.connected,true);
 }
 f.fetch(async()=>{throw new TypeError('Failed to fetch');});await assert.rejects(f.client.listSnapshots(),error=>error.code==='DRIVE_RETRYABLE');assert.equal(f.client.connected,true);
 f.fetch(async()=>new Response(null,{status:401}));await assert.rejects(f.client.listSnapshots(),error=>error.code==='DRIVE_AUTH');assert.equal(f.client.connected,false);
});
test('dedicated folder uses the signed-in username, reuses and renames the legacy folder, and relocates snapshots',async()=>{
 const f=setup();await f.client.prepare(id);await f.client.connect();f.client.user.emailAddress='gebomandra@gmail.com';assert.equal(f.client.folderName,'GuardaNotes-gebomandra');let creates=0,renames=0,moves=0;
 f.fetch(async(url,options)=>{
  if(options.method==='GET')return Response.json({files:[{id:'legacy-folder',name:'Guarda'}]});
  if(options.method==='POST'){creates++;throw Error('Must reuse legacy folder');}
  const parsed=new URL(url);const body=JSON.parse(options.body);
  if(parsed.searchParams.has('addParents')){moves++;assert.equal(parsed.searchParams.get('addParents'),'legacy-folder');assert.equal(parsed.searchParams.get('removeParents'),'old-parent');assert.equal(parsed.pathname.endsWith('/snapshot'),true);return Response.json({id:'snapshot',parents:['legacy-folder']});}
  renames++;assert.equal(body.name,'GuardaNotes-gebomandra');return Response.json({id:'legacy-folder',name:body.name});
 });
 assert.equal(await f.client.ensureFolder(),'legacy-folder');await f.client.placeSnapshot({id:'snapshot',parents:['old-parent']});await f.client.placeSnapshot({id:'already-there',parents:['legacy-folder']});assert.equal(creates,0);assert.equal(renames,1);assert.equal(moves,1);f.client.disconnect();assert.equal(f.client.folder,null);
});
test('a new dedicated folder is created once and an existing canonical folder wins over a legacy folder',async()=>{
 const f=setup();await f.client.prepare(id);await f.client.connect();let creates=0;
 f.fetch(async(url,options)=>{if(options.method==='GET')return Response.json({files:[]});creates++;const body=JSON.parse(options.body);assert.equal(body.name,'GuardaNotes-owner');assert.equal(body.appProperties.guarda,'folder-v1');return Response.json({id:'new-folder'});});
 assert.equal(await f.client.ensureFolder(),'new-folder');assert.equal(await f.client.ensureFolder(),'new-folder');assert.equal(creates,1);
 f.fetch(async(_,options)=>{assert.equal(options.method,'GET');return Response.json({files:[{id:'a',name:'Guarda'},{id:'z',name:'GuardaNotes-owner'}]});});assert.equal(await f.client.ensureFolder({refresh:true}),'z');
});
test('renewing authorization blocks synchronization with the previous account until identity is verified',async()=>{
 const f=setup();await f.client.prepare(id);await f.client.connect();let release;f.fetch(()=>new Promise(resolve=>release=resolve));const renewal=f.client.connect({hint:'owner@example.test'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.client.connected,false);release(Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}}));await renewal;assert.equal(f.client.connected,true);
});

test('an interrupted account lookup retains the authorized token and retries identity without OAuth',async()=>{
 const f=setup();await f.client.prepare(id);f.fetch(async()=>{throw new TypeError('Network interrupted');});
 await assert.rejects(f.client.connect(),error=>error.code==='DRIVE_RETRYABLE');assert.equal(f.client.hasToken,true);assert.equal(f.client.connected,false);
 f.fetch(async()=>Response.json({user:{permissionId:'owner',emailAddress:'owner@example.test'}}));await f.client.identify('owner');assert.equal(f.client.connected,true);
});
test('restored sessions must match both OAuth client and linked account before sending a token',async()=>{
 const f=setup(),snapshot={token:'handoff-token',expires:Date.now()+3500000,clientId:id,user:{permissionId:'owner'}};
 assert.equal(await f.client.restoreSession(snapshot,{clientId:'other-client',accountId:'owner'}),false);
 assert.equal(await f.client.restoreSession(snapshot,{clientId:id,accountId:'other-account'}),false);assert.equal(f.requests.length,0);
 assert.equal(await f.client.restoreSession(snapshot,{clientId:id,accountId:'owner'}),true);assert.equal(f.client.connected,true);assert.equal(f.requests[0].options.headers.Authorization,'Bearer handoff-token');
 f.fetch(async()=>Response.json({user:{permissionId:'wrong-account'}}));await assert.rejects(f.client.restoreSession(snapshot,{clientId:id,accountId:'owner'}),error=>error.code==='DRIVE_ACCOUNT');assert.equal(f.client.token,null);
});
test('a late unauthorized response from an old token cannot disconnect a newer session',async()=>{
 const f=setup();await f.client.prepare(id);await f.client.connect();let release;
 f.fetch(()=>new Promise(resolve=>release=resolve));const pending=f.client.listSnapshots();f.client.token='renewed-token';release(new Response(null,{status:401}));
 await assert.rejects(pending,error=>error.code==='DRIVE_RETRYABLE');assert.equal(f.client.token,'renewed-token');assert.equal(f.client.connected,true);
});
test('a script that loads without initializing Google can be loaded again on retry',async()=>{
 const f=setup(),env=f.client.env,google=env.google,scripts=[];delete env.google;
 env.document={createElement:()=>({remove(){}}),head:{append:script=>scripts.push(script)}};
 const failed=f.client.prepare(id);scripts[0].onload();await assert.rejects(failed,/inicializarse/);assert.equal(f.client.loading,null);
 const retry=f.client.prepare(id);assert.equal(scripts.length,2);env.google=google;scripts[1].onload();await retry;assert.ok(f.client.oauth);assert.equal(f.client.loading,null);
});
