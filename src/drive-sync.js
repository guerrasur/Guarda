import { canonical,backupUnits,localRecords,validateRelease,mergeRecords,collapseConflictCopies,materialize,recordHeads,fingerprint } from './cloud-merge.js';
function snapshotSignature(files){if(files.some(file=>typeof file.id!=='string'||typeof file.modifiedTime!=='string'||!file.modifiedTime))return null;return canonical(files.map(({id,modifiedTime})=>({id,modifiedTime})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));}
export class SyncDeferredError extends Error{constructor(message){super(message);this.code='SYNC_DEFERRED';}}
export class DriveSync{
 constructor({store,client,isBusy=()=>false,isUploadBusy=null,onStatus=()=>{},onUpload=()=>{},onApplied=async()=>{},env=globalThis}){Object.assign(this,{store,client,isBusy,isUploadBusy,onStatus,onUpload,onApplied,env});this.isUploadBusy=isUploadBusy||(()=>this.isBusy());this.running=null;this.downloads=new Map();}
 sync(){
  if(this.running)return this.running;
  if(!this.client.connected)return Promise.reject(Error('Conectá tu cuenta de Google Drive primero.'));
  if(this.isUploadBusy())return Promise.reject(new SyncDeferredError('Cerrá la nota y terminá la grabación o reproducción antes de sincronizar.'));
  this.running=this.runLocked().finally(()=>this.running=null);return this.running;
 }
 async runLocked(){
  if(!this.env.navigator?.locks)throw Error('Este navegador no admite la sincronización segura entre pestañas. Usá una versión actual de Safari, Chrome o Firefox.');
  return this.env.navigator.locks.request('guarda-drive-sync',()=>this.run());
 }
 async run(){
  if(this.isUploadBusy())throw new SyncDeferredError('Terminá la operación actual antes de sincronizar.');
  const accountId=this.client.user.permissionId,bound=await this.store.getSetting('drive-bound-account',null);
  if(bound&&bound!==accountId)throw Error('Estas notas están vinculadas a otra cuenta de Google. Volvé a conectar esa cuenta para evitar mezclarlas.');
  // Bind before any transmission, even if the first upload subsequently fails.
  if(!bound)await this.store.setSetting('drive-bound-account',accountId);
  let device=await this.store.getSetting('drive-device',null);if(!device){device=this.env.crypto.randomUUID();await this.store.setSetting('drive-device',device);}
  this.onStatus('Comprobando cambios en Drive…');
  const checkpoint=await this.store.syncCheckpoint(accountId),checked=checkpoint.state.check;
  let files,fileSignature;
  if(checked?.version===1&&checked.device===device&&checked.contentRevision===checkpoint.contentRevision){
   files=await this.client.listSnapshots();fileSignature=snapshotSignature(files);
   if(fileSignature!==null&&checked.files===fileSignature){
    const current=await this.store.syncCheckpoint(accountId);
    if(this.isUploadBusy())throw new SyncDeferredError('Terminá la operación actual antes de sincronizar.');
    if(!this.client.connected||this.client.user?.permissionId!==accountId)throw Error('La sesión de Drive cambió. Volvé a conectar la cuenta.');
    if(current.contentRevision===checkpoint.contentRevision){this.onStatus('Sin cambios. Todo está actualizado.');return {checkedOnly:true,uploaded:false,contentChanged:false,lastSync:checkpoint.state.lastSync};}
   }
  }
  const backup=await this.store.exportBackup({accountId}),state=backup.cloudState||{heads:{}};
  const local=await localRecords(backup,state.heads,device);
  backup.localRevision=await this.store.reserveSyncHeads(accountId,await recordHeads(local),backup.localRevision);
  if(this.client.prepareMedia)await this.client.prepareMedia(backup);
  files??=await this.client.listSnapshots();fileSignature=snapshotSignature(files);
  const groups=[local];let own=null;
  for(const file of files){const cached=this.downloads.get(file.id);const release=cached&&file.modifiedTime&&cached.modifiedTime===file.modifiedTime?cached.release:await this.client.readSnapshot(file.id);const records=validateRelease(release);this.downloads.set(file.id,{modifiedTime:file.modifiedTime,release});groups.push(records);if(release.device===device&&(!own||file.id<own.id))own={id:file.id,records,needsMigration:this.client.separateMedia&&release.storageVersion!==2};}
  for(const id of this.downloads.keys())if(!files.some(file=>file.id===id))this.downloads.delete(id);
  const merged=await mergeRecords(groups);
  const duplicates=collapseConflictCopies(merged.records,device),next=materialize(merged.records);
  // Uploading an immutable snapshot is safe while typing; applying remote edits waits.
  if(this.isUploadBusy())throw new SyncDeferredError('La nota abierta se conserva. La sincronización se reintentará cuando la cierres.');
  if(!this.client.connected||this.client.user?.permissionId!==accountId)throw Error('La sesión de Drive cambió. Volvé a conectar la cuenta.');
  const heads=await recordHeads(merged.records),contentChanged=await fingerprint(Object.fromEntries(backupUnits(backup)))!==await fingerprint(Object.fromEntries(backupUnits(next)));
  // Validate all downloaded notes and audio before uploading or modifying local data.
  await this.store.validateBackup(next);
  // Relocate only app-owned snapshots after their notes and attachments validate.
  if(this.client.ensureFolder)await this.client.ensureFolder({refresh:true});
  if(this.client.placeSnapshot)for(const file of files){if(this.isUploadBusy())throw new SyncDeferredError('La organización de Drive continuará al terminar la operación.');await this.client.placeSnapshot(file);}
  if(this.isUploadBusy())throw new SyncDeferredError('La sincronización continuará al terminar la operación.');
  const uploaded=!own||own.needsMigration||canonical(own.records)!==canonical(merged.records);
  if(uploaded){this.onStatus('Guardando cambios en Drive…');this.onUpload();await this.client.writeSnapshot(device,{format:'guarda-drive-sync',version:1,device,records:merged.records},own?.id);if(own)this.downloads.delete(own.id);}
  if(this.isUploadBusy())throw new SyncDeferredError('Terminá la edición antes de incorporar los cambios de Drive.');
  if(!this.client.connected||this.client.user?.permissionId!==accountId)throw Error('La sesión de Drive cambió. Tus notas locales se conservaron.');
  if(this.isBusy()){await this.store.commitUploadState(accountId,await recordHeads(local),backup.localRevision);this.onStatus('Cambios guardados en Drive. Los cambios de otros dispositivos se incorporarán al cerrar la nota.');return {uploadOnly:true};}
  const lastSync=Date.now();await this.store.importBackup(next,{expectedRevision:backup.localRevision,accountId,syncState:{heads,lastSync,check:{version:1,device,files:fileSignature,contentRevision:backup.localContentRevision+(contentChanged?1:0)}},contentChanged});
  await this.onApplied(contentChanged);
  this.onStatus(duplicates?'Sincronizado. Las copias de conflicto sin contenido distinto se movieron a la papelera.':merged.conflicts?'Sincronizado. Se conservaron copias de las notas en conflicto.':uploaded?'Cambios guardados en Drive':contentChanged?'Notas actualizadas desde Drive':'Sin cambios. Todo está actualizado.');
  return {lastSync,conflicts:merged.conflicts,contentChanged,uploaded};
 }
}
