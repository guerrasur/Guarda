export function validWaveform(value){return value?.version===1&&Array.isArray(value.peaks)&&value.peaks.length>0&&value.peaks.length<=256&&value.peaks.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&Number.isFinite(value.duration)&&value.duration>=0;}
const normalize=values=>{const max=Math.max(0,...values);return values.map(n=>max?Math.round(n/max*1000)/1000:0);};
export function waveformFromBuffer(buffer,count=160){
 const peaks=Array(count).fill(0),length=buffer.length;
 for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<length;i++){const bin=Math.min(count-1,Math.floor(i/length*count));peaks[bin]=Math.max(peaks[bin],Math.abs(data[i])||0);}}
 return {version:1,peaks:normalize(peaks),duration:buffer.duration};
}
export function waveformFromEnvelope(samples,duration,count=160){
 if(!samples.length)return null;const total=samples.reduce((sum,s)=>sum+s.span,0);const peaks=Array(count).fill(0);let position=0;
 for(const sample of samples){const first=Math.min(count-1,Math.floor(position/total*count));position+=sample.span;const last=Math.min(count-1,Math.ceil(position/total*count)-1);for(let i=first;i<=last;i++)peaks[i]=Math.max(peaks[i],sample.peak);}
 return {version:1,peaks:normalize(peaks),duration:Math.max(0,duration)};
}
export function barsPath(peaks){const step=320/peaks.length;return peaks.map((peak,i)=>{const x=((i+.5)*step).toFixed(2),height=Math.max(.7,Math.sqrt(peak)*21);return `M${x} ${(24-height).toFixed(2)}V${(24+height).toFixed(2)}`;}).join('');}
export function waveformHTML(value){
 if(!validWaveform(value))return '<span class="wave-placeholder">La onda se prepara al reproducir</span>';
 const path=barsPath(value.peaks);return `<svg viewBox="0 0 320 48" preserveAspectRatio="none" aria-hidden="true"><path class="wave-base" d="${path}"/><path class="wave-progress" d="${path}"/></svg>`;
}
export class LiveWaveform{
 constructor({element,getState,env=globalThis}){Object.assign(this,{element,getState,env});this.samples=[];this.recent=Array(48).fill(0);}
 prepare(){try{const Context=this.env.AudioContext||this.env.webkitAudioContext;if(Context&&!this.context)this.context=new Context();this.context?.resume?.().catch(()=>{});}catch{}}
 start(stream){
  this.samples=[];this.recent=Array(48).fill(0);this.last=0;this.prepare();
  try{if(!this.context)return;this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;this.data=new Uint8Array(this.analyser.fftSize);this.source=this.context.createMediaStreamSource(stream);this.source.connect(this.analyser);this.setState('recording');}catch{this.release();}
 }
 setState(state){
  this.state=state;if(this.frame){this.env.cancelAnimationFrame?.(this.frame);this.frame=null;}
  this.last=0;if(state==='recording')try{this.context?.resume?.().catch(()=>{});}catch{}if(state==='recording'&&this.analyser&&this.env.requestAnimationFrame)this.frame=this.env.requestAnimationFrame(time=>this.tick(time));
 }
 tick(time){
  this.frame=null;if(this.state!=='recording'||!this.analyser)return;
  if(!this.last||time-this.last>=40){
   this.analyser.getByteTimeDomainData(this.data);let peak=0;for(const n of this.data)peak=Math.max(peak,Math.abs((n-128)/128));
   const span=this.last?Math.max(.001,(time-this.last)/1000):.04;this.last=time;this.samples.push({peak,span});
   if(this.samples.length>4096){const compressed=[];for(let i=0;i<this.samples.length;i+=2){const a=this.samples[i],b=this.samples[i+1];compressed.push(b?{peak:Math.max(a.peak,b.peak),span:a.span+b.span}:a);}this.samples=compressed;}
   this.recent.shift();this.recent.push(peak);const path=this.element?.querySelector('path');if(path)path.setAttribute('d',barsPath(this.recent));
  }
  this.frame=this.env.requestAnimationFrame(time=>this.tick(time));
 }
 waveform(duration){return waveformFromEnvelope(this.samples,duration);}
 release(){this.setState('idle');try{this.source?.disconnect();this.analyser?.disconnect();}catch{}this.source=null;this.analyser=null;const context=this.context;this.context=null;try{context?.close?.().catch(()=>{});}catch{}}
}
export function initPlaybackWaveforms({getAttachment,decode,env=globalThis}){
 const document=env.document,cache=new Map();let frame=null;
 function duration(audio,wave){return Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:Number(wave.dataset.duration)||0;}
 function progress(audio){const wave=audio.closest('.audio-card')?.querySelector('[data-waveform]');if(!wave)return;const total=duration(audio,wave),time=Number(audio.currentTime)||0,ratio=total?Math.max(0,Math.min(1,time/total)):0;wave.style.setProperty('--audio-progress',ratio*100+'%');wave.setAttribute('aria-valuemax',String(Math.round(total)));wave.setAttribute('aria-valuenow',String(Math.round(time)));}
 function animate(){frame=null;const active=[...document.querySelectorAll('.audio-card audio')].filter(a=>a.paused===false);for(const audio of active)progress(audio);if(active.length&&env.requestAnimationFrame)frame=env.requestAnimationFrame(animate);}
 async function ensure(audio){
  const card=audio.closest('.audio-card'),wave=card?.querySelector('[data-waveform]');if(!wave||wave.dataset.ready==='true')return;
  const id=card.dataset.attachment;if(!cache.has(id))cache.set(id,Promise.resolve(getAttachment(id)).then(a=>a?decode(a.blob):null).catch(()=>null));
  wave.setAttribute('aria-busy','true');const value=await cache.get(id);if(!wave.isConnected)return;wave.removeAttribute('aria-busy');
  if(validWaveform(value)){wave.innerHTML=waveformHTML(value);wave.dataset.ready='true';wave.dataset.duration=String(value.duration);progress(audio);}else wave.innerHTML='<span class="wave-placeholder">Onda no disponible para este formato</span>';
 }
 document.addEventListener('play',event=>{const audio=event.target;if(!audio.matches?.('.audio-card audio'))return;for(const other of document.querySelectorAll('.audio-card audio'))if(other!==audio&&other.paused===false)other.pause();ensure(audio);progress(audio);if(!frame&&env.requestAnimationFrame)frame=env.requestAnimationFrame(animate);},true);
 for(const type of ['timeupdate','loadedmetadata','seeked','ended','pause'])document.addEventListener(type,event=>{if(event.target.matches?.('.audio-card audio'))progress(event.target);},true);
 function seek(wave,fraction){const audio=wave.closest('.audio-card')?.querySelector('audio');if(!audio)return;const total=duration(audio,wave);if(total)try{audio.currentTime=Math.max(0,Math.min(total,fraction*total));progress(audio);}catch{}}
 document.addEventListener('click',event=>{const wave=event.target.closest?.('[data-waveform]');if(!wave)return;event.stopPropagation();const rect=wave.getBoundingClientRect();if(rect.width)seek(wave,(event.clientX-rect.left)/rect.width);});
 document.addEventListener('keydown',event=>{const wave=event.target.closest?.('[data-waveform]');if(!wave||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const audio=wave.closest('.audio-card')?.querySelector('audio');const total=audio?duration(audio,wave):0;if(!total)return;const next=event.key==='Home'?0:event.key==='End'?total:(audio.currentTime||0)+(event.key==='ArrowRight'?5:-5);seek(wave,next/total);});
 return {progress,ensure,clear:id=>cache.delete(id)};
}
