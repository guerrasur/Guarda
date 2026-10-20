import { Mp3Encoder } from './vendor/lamejs.js';
export function encodeMonoMp3(samples,sampleRate,onProgress=()=>{}){
 const encoder=new Mp3Encoder(1,sampleRate,96),chunks=[];const block=1152;let last=-1;
 for(let offset=0;offset<samples.length;offset+=block){
  const end=Math.min(offset+block,samples.length),pcm=new Int16Array(end-offset);for(let i=offset;i<end;i++){const value=Math.max(-1,Math.min(1,samples[i]));pcm[i-offset]=Math.round(value*(value<0?32768:32767));}
  const chunk=encoder.encodeBuffer(pcm);if(chunk.length)chunks.push(new Uint8Array(chunk));const percent=Math.floor(end/samples.length*100/5)*5;if(percent!==last){last=percent;onProgress(percent);}
 }
 const tail=encoder.flush();if(tail.length)chunks.push(new Uint8Array(tail));return new Blob(chunks,{type:'audio/mpeg'});
}
if(typeof self!=='undefined')self.onmessage=event=>{try{const {samples,sampleRate}=event.data;const blob=encodeMonoMp3(new Float32Array(samples),sampleRate,progress=>self.postMessage({progress}));self.postMessage({blob});}catch(error){self.postMessage({error:error.message||'No se pudo convertir a MP3.'});}};
