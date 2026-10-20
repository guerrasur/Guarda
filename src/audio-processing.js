import { waveformFromBuffer } from './audio-waveform.js';
export async function decodeAudio(blob,env=globalThis){
 const Context=env.AudioContext||env.webkitAudioContext;if(!Context)return null;let context,timer;
 try{try{context=new Context({sampleRate:44100});}catch{context=new Context();}
  const data=await blob.arrayBuffer();return await Promise.race([context.decodeAudioData(data),new Promise((_,reject)=>timer=env.setTimeout(()=>reject(Error('El análisis de audio tardó demasiado.')),15000))]);
 }finally{env.clearTimeout(timer);try{await context?.close?.();}catch{}}
}
export async function decodeWaveform(blob,env=globalThis){try{const buffer=await decodeAudio(blob,env);return buffer?waveformFromBuffer(buffer):null;}catch{return null;}}
export function encodeMp3(buffer,{env=globalThis,onProgress=()=>{}}={}){
 if(!env.Worker)return Promise.reject(Error('Este navegador no permite convertir el audio en segundo plano.'));
 return new Promise((resolve,reject)=>{
  const worker=new env.Worker(new URL('./mp3-worker.js',import.meta.url),{type:'module'});const timer=env.setTimeout(()=>{worker.terminate();reject(Error('La conversión a MP3 tardó demasiado.'));},120000);
  const finish=(error,blob)=>{env.clearTimeout(timer);worker.terminate();error?reject(error):resolve(blob);};
  worker.onmessage=event=>{if(event.data.error)finish(Error(event.data.error));else if(event.data.blob)finish(null,event.data.blob);else if(Number.isFinite(event.data.progress))onProgress(event.data.progress);};worker.onerror=()=>finish(Error('No se pudo convertir la grabación a MP3.'));
  try{const mono=new Float32Array(buffer.length);for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<mono.length;i++)mono[i]+=data[i]/buffer.numberOfChannels;}worker.postMessage({samples:mono.buffer,sampleRate:buffer.sampleRate},[mono.buffer]);}catch(error){finish(error);}
 });
}
export async function prepareRecording(recording,{fallbackWaveform=null,onProgress=()=>{},env=globalThis}={}){
 let waveform=fallbackWaveform;try{const buffer=await decodeAudio(recording.blob,env);if(buffer){waveform=waveformFromBuffer(buffer);if(!recording.mimeType?.startsWith('audio/mpeg')){onProgress(0);const blob=await encodeMp3(buffer,{env,onProgress});return {...recording,blob,mimeType:'audio/mpeg',duration:buffer.duration,waveform};}}}catch{}
 return {...recording,waveform,conversionFailed:!recording.mimeType?.startsWith('audio/mpeg')};
}

export function audioExtension(type=''){return type.includes('mpeg')?'mp3':type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':type.includes('wav')?'wav':type.includes('webm')?'webm':'bin';}
