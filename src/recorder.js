export function microphoneError(error) {
  const messages = {
    NotAllowedError: 'No se permitió usar el micrófono. Habilitalo en los permisos del navegador y volvé a intentar.',
    PermissionDeniedError: 'No se permitió usar el micrófono. Habilitalo en los permisos del navegador y volvé a intentar.',
    NotFoundError: 'No se encontró un micrófono conectado.',
    NotReadableError: 'No se pudo abrir el micrófono. Puede estar ocupado por otra aplicación.',
    SecurityError: 'Para grabar audio, abrí Guarda desde una conexión segura HTTPS.',
    AbortError: 'La grabación se interrumpió. Podés volver a intentar.',
  };
  return new Error(messages[error?.name] || `No se pudo grabar el audio: ${error?.message || 'error del micrófono'}`, { cause: error });
}

export class AudioRecorder {
  constructor({ onChunk, onState, onError, onStream } = {}) {
    this.onStream = onStream; this.onChunk = onChunk; this.onState = onState; this.onError = onError;
    this._state = 'idle'; this._token = 0; this._chunks = []; this._pending = Promise.resolve();
  }
  get state() { return this._state; }
  _setState(state) { this._state = state; this.onState?.(state); }
  _duration() { return this._elapsed + (this._state === 'recording' ? performance.now() - this._startedAt : 0); }
  _release() { this._stream?.getTracks().forEach(track => track.stop()); this._stream = null; try { this.onStream?.(null); } catch {} }
  async start() {
    if (this.state !== 'idle') throw new Error('Ya hay una grabación en curso.');
    if (!globalThis.navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const error = new Error('Este navegador no permite grabar audio. Usá Safari o Chrome actualizado desde una conexión HTTPS.');
      this.onError?.(error); throw error;
    }
    const token = ++this._token;
    this._setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== this._token) { stream.getTracks().forEach(track => track.stop()); return; }
      this._stream = stream;
      const preferred = ['audio/mpeg', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = preferred.find(type => MediaRecorder.isTypeSupported?.(type));
      this._recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this._chunks = []; this._pending = Promise.resolve(); this._chunkError = null;
      this._elapsed = 0; this._startedAt = performance.now(); this._index = 0;
      this._mimeType = this._recorder.mimeType || mimeType || '';
      this._finish = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
      // Prevent a spontaneous recorder error from becoming an unhandled rejection before stop().
      this._finish.catch(() => {});
      this._recorder.ondataavailable = event => {
        if (token !== this._token || !event.data?.size) return;
        this._chunks.push(event.data);
        const chunk = { blob: event.data, index: this._index++, mimeType: event.data.type || this._mimeType, elapsed: this._duration() / 1000 };
        this._pending = this._pending.then(() => this.onChunk?.(chunk)).catch(error => { this._chunkError ||= error; });
      };
      this._recorder.onerror = event => {
        if (token !== this._token) return;
        const error = microphoneError(event.error || event);
        this._recordError = error;
        this._release(); this.onError?.(error);
        this._reject(error); this._setState('idle');
      };
      this._recordError = null;
      this._recorder.onstop = async () => {
        if (token !== this._token) return;
        this._release();
        await this._pending;
        if (token !== this._token) return;
        if (this._recordError) return;
        if (this._chunkError) {
          const error = new Error('No se pudo guardar un fragmento de la grabación. No cierres la nota e intentá guardar nuevamente.', { cause: this._chunkError });
          // Preserve the complete in-memory audio so callers can still recover it.
          error.recording = this._result(); this.onError?.(error); this._reject(error);
        } else this._resolve(this._result());
        this._setState('idle');
      };
      this._recorder.start(1000);
      try { this.onStream?.(stream); } catch {}
      this._setState('recording');
    } catch (cause) {
      if (token !== this._token) return;
      this._release(); this._setState('idle');
      const error = microphoneError(cause); this.onError?.(error); throw error;
    }
  }
  _result() {
    const mimeType = this._mimeType || this._chunks[0]?.type || 'application/octet-stream';
    return { blob: new Blob(this._chunks, { type: mimeType }), mimeType, duration: this._elapsed / 1000 };
  }
  pause() {
    if (this.state !== 'recording') return;
    this._recorder.pause(); this._elapsed = this._duration(); this._setState('paused');
  }
  resume() {
    if (this.state !== 'paused') return;
    this._recorder.resume(); this._startedAt = performance.now(); this._setState('recording');
  }
  async stop() {
    if (this.state === 'stopping') return this._finish;
    if (!['recording', 'paused'].includes(this.state)) throw new Error('No hay una grabación en curso.');
    this._elapsed = this._duration(); this._setState('stopping');
    try { this._recorder.stop(); } catch (cause) { this._release(); this._setState('idle'); throw microphoneError(cause); }
    return this._finish;
  }
  cancel() {
    const previous = this.state;
    ++this._token;
    if (this._recorder && this._recorder.state !== 'inactive') { try { this._recorder.stop(); } catch {} }
    this._release(); this._chunks = [];
    if (previous !== 'idle' && previous !== 'requesting') this._reject?.(new Error('Grabación descartada.'));
    this._setState('idle');
  }
}
