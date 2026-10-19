const STORES = ['notes', 'attachments', 'labels', 'settings'];
const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || new Error('La operación fue cancelada.'));
  transaction.onerror = () => {}; // Abort supplies the actual error.
});
function storageError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('No hay espacio suficiente. Exportá una copia de seguridad y liberá espacio antes de volver a guardar.', { cause: error });
  return new Error(`No se pudo guardar o leer la información: ${error?.message || 'error de almacenamiento'}`, { cause: error });
}
function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 500; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function validateNote(note) {
  assert(object(note) && validId(note.id), 'La nota no tiene un identificador válido.');
  assert(typeof note.title === 'string' && typeof note.body === 'string', 'El texto de la nota no es válido.');
  assert(Array.isArray(note.attachments) && note.attachments.every(validId), 'Los adjuntos de la nota no son válidos.');
  assert(Array.isArray(note.labels) && note.labels.every(validId), 'Las etiquetas de la nota no son válidas.');
  assert(Array.isArray(note.items) && note.items.every(item => object(item) && validId(item.id) && typeof item.text === 'string' && typeof item.checked === 'boolean'), 'La lista de la nota no es válida.');
}
function validateLabel(label) { assert(object(label) && validId(label.id) && typeof label.name === 'string' && label.name.trim().length > 0, 'La etiqueta no es válida.'); }
function validateAttachment(attachment) {
  assert(object(attachment) && validId(attachment.id) && validId(attachment.noteId), 'El adjunto no tiene un identificador válido.');
  assert(attachment.blob instanceof Blob && typeof attachment.type === 'string' && typeof attachment.name === 'string', 'El archivo adjunto no es válido.');
}
async function encodeBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let result = '';
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
}
function decodeBlob(base64, type) {
  assert(typeof base64 === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64), 'Un archivo de la copia está dañado.');
  const binary = atob(base64);
  return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type });
}

export class GuardaStore extends EventTarget {
  constructor({ name = 'guarda-local', broadcast = true } = {}) {
    super(); this.name = name; this.db = null; this.opening = null;
    if (broadcast && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`${name}-changes`);
      this.channel.onmessage = event => this.dispatchEvent(new CustomEvent('change', { detail: { ...event.data, remote: true } }));
    }
  }
  async init() {
    if (this.db) return this;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      if (!globalThis.indexedDB) throw new Error('Este navegador no permite guardar notas localmente.');
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
        const store = request.transaction.objectStore('attachments');
        if (!store.indexNames.contains('noteId')) store.createIndex('noteId', 'noteId');
      };
      this.db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(storageError(request.error));
        request.onblocked = () => reject(new Error('Cerrá las otras pestañas de Guarda para actualizar el almacenamiento.'));
      });
      this.db.onversionchange = () => { this.db.close(); this.db = null; this.opening = null; };
      return this;
    })().catch(error => { this.opening = null; throw error; });
    return this.opening;
  }
  async _run(stores, mode, operation, detail) {
    await this.init();
    const transaction = this.db.transaction(stores, mode);
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction);
      await done;
      if (detail) { this.dispatchEvent(new CustomEvent('change', { detail })); this.channel?.postMessage(detail); }
      return result;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw storageError(error);
    }
  }
  // A transaction covering every store waits for prior writes to commit.
  whenIdle() { return this._run(STORES, 'readonly', () => {}); }
  async reorderNotes(positions) {
    assert(Array.isArray(positions) && positions.every(p=>validId(p.id)&&Number.isFinite(p.order)), 'El orden no es válido.');
    assert(new Set(positions.map(p=>p.id)).size===positions.length, 'Hay notas repetidas en el orden.');
    return this._run(['notes'], 'readwrite', async tx=>{
      const notes=tx.objectStore('notes');
      const current=await Promise.all(positions.map(p=>requestResult(notes.get(p.id))));
      assert(current.every(Boolean), 'Una nota ya no existe.');
      for(let i=0;i<positions.length;i++)notes.put({...current[i],order:positions[i].order});
    }, {type:'reorder-notes'});
  }
  allNotes() { return this._run(['notes'], 'readonly', tx => requestResult(tx.objectStore('notes').getAll())); }
  async putNote(note) {
    validateNote(note);
    return this._run(['notes'], 'readwrite', tx => requestResult(tx.objectStore('notes').put(note)), { type: 'note', id: note.id });
  }
  deleteNote(id) {
    return this._run(['notes', 'attachments'], 'readwrite', async tx => {
      const attachments = tx.objectStore('attachments');
      const keys = await requestResult(attachments.index('noteId').getAllKeys(id));
      for (const key of keys) attachments.delete(key);
      tx.objectStore('notes').delete(id);
    }, { type: 'delete-note', id });
  }
  allLabels() { return this._run(['labels'], 'readonly', tx => requestResult(tx.objectStore('labels').getAll())); }
  async putLabel(label) {
    validateLabel(label);
    return this._run(['labels'], 'readwrite', tx => requestResult(tx.objectStore('labels').put(label)), { type: 'label', id: label.id });
  }
  deleteLabel(id) {
    return this._run(['notes', 'labels'], 'readwrite', async tx => {
      const notes = tx.objectStore('notes');
      const all = await requestResult(notes.getAll());
      for (const note of all) if (note.labels.includes(id)) notes.put({ ...note, labels: note.labels.filter(label => label !== id) });
      tx.objectStore('labels').delete(id);
    }, { type: 'delete-label', id });
  }
  async putAttachment(attachment) {
    validateAttachment(attachment);
    return this._run(['attachments'], 'readwrite', tx => requestResult(tx.objectStore('attachments').put(attachment)), { type: 'attachment', id: attachment.id, noteId: attachment.noteId });
  }
  async attachToNote(note, attachment, { deleteIds = [] } = {}) {
    validateNote(note); validateAttachment(attachment);
    assert(attachment.noteId === note.id, 'El adjunto pertenece a otra nota.');
    assert(Array.isArray(deleteIds) && deleteIds.every(validId) && !deleteIds.includes(attachment.id), 'Los fragmentos a reemplazar no son válidos.');
    const obsolete = new Set(deleteIds);
    const updatedNote = { ...note, attachments: [...new Set([...note.attachments.filter(id => !obsolete.has(id)), attachment.id])] };
    return this._run(['notes', 'attachments'], 'readwrite', async tx => {
      const attachments = tx.objectStore('attachments');
      // Never remove a fragment belonging to a different note.
      const records = await Promise.all(deleteIds.map(id => requestResult(attachments.get(id))));
      assert(records.every(record => !record || record.noteId === note.id), 'Un fragmento pertenece a otra nota.');
      for (const id of deleteIds) attachments.delete(id);
      attachments.put(attachment);
      tx.objectStore('notes').put(updatedNote);
      return updatedNote;
    }, { type: 'attachment', id: attachment.id, noteId: note.id });
  }
  getAttachment(id) { return this._run(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').get(id))); }
  deleteAttachment(id) {
    return this._run(['notes', 'attachments'], 'readwrite', async tx => {
      const attachments = tx.objectStore('attachments');
      const attachment = await requestResult(attachments.get(id));
      if (attachment) {
        const notes = tx.objectStore('notes');
        const note = await requestResult(notes.get(attachment.noteId));
        if (note) notes.put({ ...note, attachments: note.attachments.filter(value => value !== id) });
      }
      attachments.delete(id);
    }, { type: 'delete-attachment', id });
  }
  async getSetting(key, fallback) {
    const record = await this._run(['settings'], 'readonly', tx => requestResult(tx.objectStore('settings').get(key)));
    return record ? record.value : fallback;
  }
  setSetting(key, value) { return this._run(['settings'], 'readwrite', tx => requestResult(tx.objectStore('settings').put({ id: key, value })), { type: 'setting', id: key }); }
  async exportBackup() {
    const snapshot = await this._run(STORES, 'readonly', async tx => {
      const records = await Promise.all(STORES.map(name => requestResult(tx.objectStore(name).getAll())));
      return Object.fromEntries(STORES.map((name, index) => [name, records[index]]));
    });
    snapshot.attachments = await Promise.all(snapshot.attachments.map(async ({ blob, ...attachment }) => ({ ...attachment, data: await encodeBlob(blob) })));
    return { format: 'guarda-backup', version: 1, exportedAt: Date.now(), ...snapshot };
  }
  async importBackup(data) {
    assert(object(data) && data.format === 'guarda-backup' && data.version === 1, 'La copia no tiene un formato de Guarda compatible.');
    for (const name of STORES) assert(Array.isArray(data[name]), `Falta la sección ${name} de la copia.`);
    const unique = (records, name) => { const ids = new Set(); for (const record of records) { assert(validId(record?.id) && !ids.has(record.id), `Hay identificadores inválidos o repetidos en ${name}.`); ids.add(record.id); } return ids; };
    const noteIds = unique(data.notes, 'notas'); const labelIds = unique(data.labels, 'etiquetas'); unique(data.settings, 'ajustes');
    data.notes.forEach(validateNote); data.labels.forEach(validateLabel);
    const attachments = data.attachments.map(({ data: encoded, ...attachment }) => { const record = { ...attachment, blob: decodeBlob(encoded, attachment.type) }; validateAttachment(record); return record; });
    const attachmentIds = unique(attachments, 'adjuntos');
    const attachmentMap = new Map(attachments.map(attachment => [attachment.id, attachment]));
    for (const note of data.notes) {
      assert(note.labels.every(id => labelIds.has(id)), 'Una nota usa una etiqueta inexistente.');
      assert(note.attachments.every(id => attachmentIds.has(id) && attachmentMap.get(id).noteId === note.id), 'Una nota hace referencia a un adjunto inexistente o ajeno.');
    }
    const noteMap = new Map(data.notes.map(note => [note.id, note]));
    for (const attachment of attachments) assert(noteIds.has(attachment.noteId) && noteMap.get(attachment.noteId).attachments.includes(attachment.id), 'Un adjunto no pertenece a ninguna nota.');
    // Decode and validate everything before opening the single replacement transaction.
    return this._run(STORES, 'readwrite', tx => {
      const records = { ...data, attachments };
      for (const name of STORES) { const store = tx.objectStore(name); store.clear(); for (const record of records[name]) store.put(record); }
    }, { type: 'import' });
  }
  close() { this.db?.close(); this.db = null; this.opening = null; this.channel?.close(); }
}
