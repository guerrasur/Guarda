import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';
import {waveformFromBuffer,waveformFromEnvelope,validWaveform,LiveWaveform,waveformHTML,initPlaybackWaveforms} from '../src/audio-waveform.js';
import {prepareRecording} from '../src/audio-processing.js';import {encodeMonoMp3} from '../src/mp3-worker.js';
function buffer(){const data=Float32Array.from({length:4410},(_,i)=>.6*Math.sin(i*2*Math.PI*440/44100));return {length:data.length,sampleRate:44100,duration:.1,numberOfChannels:1,getChannelData:()=>data};}
test('complete waveform includes all channels, preserves silence and rejects malformed metadata',()=>{
 const waveform=waveformFromBuffer({length:8,numberOfChannels:2,duration:2,getChannelData:channel=>Float32Array.from(channel?[0,0,0,.5,0,0,1,0]:[0,.2,0,0,0,0,0,0])},4);assert.deepEqual(waveform.peaks,[.2,.5,0,1]);assert.equal(validWaveform(waveform),true);
 assert.deepEqual(waveformFromBuffer({length:4,numberOfChannels:1,duration:1,getChannelData:()=>new Float32Array(4)},2).peaks,[0,0]);assert.equal(validWaveform({version:1,peaks:[NaN],duration:1}),false);assert.equal(validWaveform({version:1,peaks:[2],duration:1}),false);
 const envelope=waveformFromEnvelope([{peak:1,span:1},{peak:0,span:3}],4,4);assert.deepEqual(envelope.peaks,[1,0,0,0]);assert.match(waveformHTML(waveform),/wave-progress/);
});
test('live meter follows microphone samples, pauses animation and releases its analysis graph',()=>{
 const {document}=parseHTML('<svg id="meter"><path></path></svg>');let level=128,closed=0,disconnected=0,seq=0;const frames=new Map();
 const env={AudioContext:class{resume(){return Promise.resolve();}close(){closed++;return Promise.resolve();}createAnalyser(){return {fftSize:1024,getByteTimeDomainData:data=>data.fill(level),disconnect:()=>disconnected++};}createMediaStreamSource(){return {connect(){},disconnect:()=>disconnected++};}},requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id)};
 const live=new LiveWaveform({element:document.getElementById('meter'),env});live.start({});const tick=time=>{const [id,fn]=[...frames.entries()][0];frames.delete(id);fn(time);};tick(50);const silent=document.querySelector('path').getAttribute('d');level=240;tick(100);assert.notEqual(document.querySelector('path').getAttribute('d'),silent);assert.equal(live.waveform(1).peaks.some(n=>n>0),true);
 live.setState('paused');assert.equal(frames.size,0);live.setState('recording');assert.equal(frames.size,1);live.release();assert.equal(frames.size,0);assert.equal(closed,1);assert.equal(disconnected,2);
});
test('MP3 encoder produces MPEG frames and conversion fallback preserves the original recording',async()=>{
 const pcm=buffer();const mp3=encodeMonoMp3(pcm.getChannelData(0),44100);const bytes=new Uint8Array(await mp3.arrayBuffer());assert.equal(mp3.type,'audio/mpeg');assert.ok(bytes.length>1000);assert.equal(bytes[0],255);assert.equal(bytes[1]&224,224);
 const source={blob:new Blob(['original'],{type:'audio/mp4'}),mimeType:'audio/mp4',duration:.1};const fallback=await prepareRecording(source,{env:{clearTimeout(){}}});assert.equal(fallback.blob,source.blob);assert.equal(fallback.conversionFailed,true);
});
test('browser MP3 processing saves valid waveform metadata, closes decoder and terminates worker',async()=>{
 let closes=0,terminations=0;const pcm=buffer();const env={setTimeout,clearTimeout,AudioContext:class{decodeAudioData(){return Promise.resolve(pcm);}close(){closes++;return Promise.resolve();}},Worker:class{constructor(url,options){assert.match(url.pathname,/mp3-worker.js$/);assert.equal(options.type,'module');}postMessage({samples,sampleRate}){queueMicrotask(()=>this.onmessage({data:{blob:encodeMonoMp3(new Float32Array(samples),sampleRate)}}));}terminate(){terminations++;}}};
 const source={blob:new Blob(['original'],{type:'audio/mp4'}),mimeType:'audio/mp4',duration:.1};const processed=await prepareRecording(source,{env});assert.equal(processed.mimeType,'audio/mpeg');assert.equal(processed.blob.type,'audio/mpeg');assert.equal(validWaveform(processed.waveform),true);assert.equal(closes,1);assert.equal(terminations,1);
});
test('playback shows full waveform, follows playback time and supports touch and keyboard seeking',async()=>{
 const waveform={version:1,peaks:[0,.2,.9,.4],duration:20};const {document,window}=parseHTML(`<div class="audio-card" data-attachment="sound"><div data-waveform data-ready="true" data-duration="20" role="slider">${waveformHTML(waveform)}</div><audio></audio></div>`);const audio=document.querySelector('audio'),wave=document.querySelector('[data-waveform]');audio.duration=20;audio.currentTime=5;audio.paused=true;wave.getBoundingClientRect=()=>({left:0,width:200});
 const ui=initPlaybackWaveforms({getAttachment:async()=>null,decode:async()=>null,env:{document}});ui.progress(audio);assert.equal(wave.getAttribute('aria-valuenow'),'5');assert.equal(wave.style.getPropertyValue('--audio-progress'),'25%');
 const click=new window.Event('click',{bubbles:true});click.clientX=100;wave.dispatchEvent(click);assert.equal(audio.currentTime,10);const key=new window.Event('keydown',{bubbles:true});key.key='ArrowRight';wave.dispatchEvent(key);assert.equal(audio.currentTime,15);
});
test('failed MP3 worker retains exact original audio and a complete measured waveform',async()=>{
 const source={blob:new Blob(['safe original'],{type:'audio/mp4'}),mimeType:'audio/mp4',duration:.1};const env={setTimeout,clearTimeout,AudioContext:class{decodeAudioData(){return Promise.resolve(buffer());}close(){return Promise.resolve();}},Worker:class{postMessage(){queueMicrotask(()=>this.onmessage({data:{error:'encoder unavailable'}}));}terminate(){}}};
 const saved=await prepareRecording(source,{env});assert.equal(saved.blob,source.blob);assert.equal(await saved.blob.text(),'safe original');assert.equal(saved.mimeType,'audio/mp4');assert.equal(saved.conversionFailed,true);assert.equal(validWaveform(saved.waveform),true);
});
test('waveform work starts on play, reuses stored peaks and cached decoding, and stops animation on pause',async()=>{
 const {document,window}=parseHTML('<div class="audio-card" data-attachment="sound"><div hidden data-waveform data-ready="false"></div><audio></audio></div>');const audio=document.querySelector('audio'),wave=document.querySelector('[data-waveform]');let reads=0,decodes=0,next=0;const frames=new Map();const value={version:1,peaks:[.1,1,.3],duration:20};
 const ui=initPlaybackWaveforms({getAttachment:async()=>{reads++;return {blob:new Blob(['audio']),waveform:value};},decode:async()=>{decodes++;return value;},env:{document,requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)}});
 assert.equal(reads,0);assert.equal(wave.querySelector('svg'),null);assert.equal(wave.hidden,true);audio.paused=false;audio.dispatchEvent(new window.Event('play',{bubbles:true}));await ui.ensure(audio);assert.equal(wave.hidden,false);assert.ok(wave.querySelector('svg'));assert.equal(reads,1);assert.equal(decodes,0);assert.equal(frames.size,1);audio.paused=true;audio.dispatchEvent(new window.Event('pause',{bubbles:true}));assert.equal(frames.size,0);
 wave.dataset.ready='false';await ui.ensure(audio);assert.equal(reads,1);
 ui.clear('sound');wave.dataset.ready='false';const lazy=initPlaybackWaveforms({getAttachment:async()=>({blob:new Blob(['old audio'])}),decode:async()=>{decodes++;return value;},env:{document}});await lazy.ensure(audio);wave.dataset.ready='false';await lazy.ensure(audio);assert.equal(decodes,1);
});
