import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { GuardaStore } from '../src/storage.js';

const note = (id = 'note-1', extra = {}) => ({ id, title: 'Título', body: 'Texto', items: [], isList: false, labels: [], attachments: [], pinned: false, archived: false, deletedAt: null, color: 'default', createdAt: 1, updatedAt: 1, ...extra });
let sequence = 0;
async function open(t) {
  const store = new GuardaStore({ name: `test-guarda-${++sequence}`, broadcast: false });
  await store.init(); t.after(() => store.close()); return store;
}
test('committed notes and settings survive a new database connection', async t => {
  const store = await open(t); await store.putNote(note()); await store.setSetting('theme', 'dark');
  const second = new GuardaStore({ name: store.name, broadcast: false }); await second.init(); t.after(() => second.close());
  assert.deepEqual(await second.allNotes(), [note()]); assert.equal(await second.getSetting('theme', 'light'), 'dark');
  assert.equal(await second.getSetting('missing', 42), 42);
});
test('deleting labels unlinks all notes; deleting note cascades audio files', async t => {
  const store = await open(t); await store.putLabel({ id: 'label-1', name: 'Ideas' });
  await store.putNote(note('note-1', { labels: ['label-1'], attachments: ['audio-1'] }));
  await store.putAttachment({ id: 'audio-1', noteId: 'note-1', blob: new Blob(['voice'], { type: 'audio/mp4' }), type: 'audio/mp4', name: 'Audio', createdAt: 1 });
  await store.deleteLabel('label-1'); assert.deepEqual((await store.allNotes())[0].labels, []);
  await store.deleteNote('note-1'); assert.deepEqual(await store.allNotes(), []); assert.equal(await store.getAttachment('audio-1'), undefined);
});
test('backup round trip retains text, relationships, settings and original audio bytes', async t => {
  const source = await open(t); const target = await open(t);
  await source.putLabel({ id: 'label-1', name: 'Canciones' });
  await source.putNote(note('note-1', { labels: ['label-1'], attachments: ['audio-1'] }));
  const bytes = Uint8Array.from([0, 255, 128, 1, 42]);
  await source.putAttachment({ id: 'audio-1', noteId: 'note-1', blob: new Blob([bytes], { type: 'audio/mp4' }), type: 'audio/mp4', name: 'Voz', duration: 3.2, createdAt: 1 });
  await source.setSetting('theme', 'dark');
  const backup = await source.exportBackup();
  await target.importBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(await target.allNotes(), await source.allNotes());
  assert.deepEqual(await target.allLabels(), await source.allLabels());
  assert.equal(await target.getSetting('theme'), 'dark');
  const restored = await target.getAttachment('audio-1');
  assert.deepEqual(new Uint8Array(await restored.blob.arrayBuffer()), bytes); assert.equal(restored.duration, 3.2);
});
test('invalid or orphaned backup is rejected before altering existing data', async t => {
  const store = await open(t); await store.putNote(note('existing'));
  const backup = await store.exportBackup();
  backup.notes = [note('incoming', { attachments: ['missing'] })];
  await assert.rejects(store.importBackup(backup), /adjunto inexistente/);
  assert.equal((await store.allNotes())[0].id, 'existing');
  backup.notes = [note('duplicate'), note('duplicate')];
  await assert.rejects(store.importBackup(backup), /repetidos/);
  assert.equal((await store.allNotes())[0].id, 'existing');
});
test('failed replacement transaction rolls back previously cleared records', async t => {
  const store = await open(t); await store.putNote(note('existing'));
  const backup = await store.exportBackup();
  backup.notes = [note('incoming')];
  // A function is not structured-cloneable. This fails during the transaction,
  // after the clear/put requests for notes have already been queued.
  backup.settings = [{ id: 'bad', value: () => {} }];
  await assert.rejects(store.importBackup(backup), /No se pudo guardar/);
  assert.deepEqual((await store.allNotes()).map(value => value.id), ['existing']);
});
test('change events are emitted after commit, so listeners can read fresh notes', async t => {
  const store = await open(t);
  const observed = new Promise(resolve => store.addEventListener('change', async event => resolve({ detail: event.detail, notes: await store.allNotes() }), { once: true }));
  await store.putNote(note()); const result = await observed;
  assert.equal(result.detail.type, 'note'); assert.deepEqual(result.notes, [note()]);
});
test('attachToNote atomically links audio and consolidation removes draft fragments', async t => {
  const store = await open(t);
  const makeAudio = id => ({ id, noteId: 'note-1', blob: new Blob([id], { type: 'audio/mp4' }), type: 'audio/mp4', name: id, createdAt: 1 });
  await store.attachToNote(note(), makeAudio('draft-1'));
  const draftNote = (await store.allNotes())[0]; assert.deepEqual(draftNote.attachments, ['draft-1']);
  const updated = await store.attachToNote(draftNote, makeAudio('final'), { deleteIds: ['draft-1'] });
  assert.deepEqual(updated.attachments, ['final']); assert.equal(await store.getAttachment('draft-1'), undefined);
  const backup = await store.exportBackup();
  assert.deepEqual(backup.notes[0].attachments, ['final']); assert.deepEqual(backup.attachments.map(audio => audio.id), ['final']);
  const restored = await open(t); await restored.importBackup(backup);
  assert.equal(await (await restored.getAttachment('final')).blob.text(), 'final');
});
test('failed atomic attachment write rolls back both note and fragment changes', async t => {
  const store = await open(t);
  const original = note(); await store.putNote(original);
  const draft = { id: 'draft', noteId: original.id, blob: new Blob(['draft']), type: 'audio/mp4', name: 'draft', createdAt: 1 };
  await store.attachToNote(original, draft);
  const before = (await store.allNotes())[0];
  const invalid = { ...draft, id: 'final', nonCloneable: () => {} };
  await assert.rejects(store.attachToNote({ ...before, title: 'Changed' }, invalid, { deleteIds: ['draft'] }), /No se pudo guardar/);
  assert.deepEqual((await store.allNotes())[0], before);
  assert.equal(await (await store.getAttachment('draft')).blob.text(), 'draft');
  assert.equal(await store.getAttachment('final'), undefined);
});
test('atomic attachment cannot remove another note’s audio', async t => {
  const store = await open(t);
  const audio = { id: 'other-audio', noteId: 'other-note', blob: new Blob(['voice']), type: 'audio/mp4', name: 'Voz', createdAt: 1 };
  await store.attachToNote(note('other-note'), audio);
  await assert.rejects(store.attachToNote(note(), { ...audio, id: 'mine', noteId: 'note-1' }, { deleteIds: ['other-audio'] }), /pertenece a otra nota/);
  assert.equal((await store.allNotes()).length, 1); assert.ok(await store.getAttachment('other-audio'));
});
