import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRecorder } from '../src/recorder.js';

let tracks;
class FakeMediaRecorder {
  static isTypeSupported(type) { return type === 'audio/mp4'; }
  constructor(stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; FakeMediaRecorder.last = this; }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  chunk(text) { this.ondataavailable({ data: new Blob([text], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; queueMicrotask(() => { this.chunk('last'); this.onstop(); }); }
}
beforeEach(() => {
  tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => tracks }) } } });
  globalThis.MediaRecorder = FakeMediaRecorder;
});
test('records actual audio, selects Safari MIME, and waits for durable chunks', async () => {
  const persisted = [];
  const recorder = new AudioRecorder({ onChunk: async chunk => { await new Promise(resolve => setTimeout(resolve, 5)); persisted.push(await chunk.blob.text()); } });
  await recorder.start();
  FakeMediaRecorder.last.chunk('first');
  const result = await recorder.stop();
  assert.equal(result.mimeType, 'audio/mp4');
  assert.equal(await result.blob.text(), 'firstlast');
  assert.deepEqual(persisted, ['first', 'last']);
  assert.equal(recorder.state, 'idle'); assert.equal(tracks[0].stopped, true);
});
test('pause and resume keep the same recorder and stop releases microphone', async () => {
  const recorder = new AudioRecorder(); await recorder.start();
  const media = FakeMediaRecorder.last;
  recorder.pause(); assert.equal(recorder.state, 'paused'); assert.equal(media.state, 'paused');
  recorder.resume(); assert.equal(recorder.state, 'recording');
  await recorder.stop(); assert.equal(tracks[0].stopped, true);
});
test('chunk storage failure preserves recording for recovery', async () => {
  const recorder = new AudioRecorder({ onChunk: () => { throw new Error('quota'); } });
  await recorder.start();
  let failure;
  await assert.rejects(recorder.stop(), error => { failure = error; return !!error.recording; });
  assert.equal(await failure.recording.blob.text(), 'last');
  assert.equal(tracks[0].stopped, true);
});
test('cancel while permissions pending stops late microphone stream', async () => {
  let grant;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const recorder = new AudioRecorder(); const opening = recorder.start();
  assert.equal(recorder.state, 'requesting'); recorder.cancel();
  grant({ getTracks: () => tracks }); await opening;
  assert.equal(recorder.state, 'idle'); assert.equal(tracks[0].stopped, true);
});
test('permission denial is reported in Spanish and can be retried', async () => {
  navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  const recorder = new AudioRecorder();
  await assert.rejects(recorder.start(), /No se permitió usar el micrófono/);
  assert.equal(recorder.state, 'idle');
});
test('stream visualization hooks receive the microphone once and release it on stop without affecting the recording',async()=>{
 const streams=[];const recorder=new AudioRecorder({onStream:stream=>streams.push(stream)});await recorder.start();assert.ok(streams[0]);await recorder.stop();assert.equal(streams.at(-1),null);assert.equal(tracks[0].stopped,true);
});
test('recording prefers genuine native MPEG when the browser advertises support',async()=>{
 FakeMediaRecorder.isTypeSupported=type=>['audio/mpeg','audio/mp4'].includes(type);try{const recorder=new AudioRecorder();await recorder.start();assert.equal(FakeMediaRecorder.last.mimeType,'audio/mpeg');const result=await recorder.stop();assert.equal(result.mimeType,'audio/mpeg');}finally{FakeMediaRecorder.isTypeSupported=type=>type==='audio/mp4';}
});
