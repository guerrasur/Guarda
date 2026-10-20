import test from 'node:test';import assert from 'node:assert/strict';import {validateFiles,MAX_FILE_BYTES,MAX_NOTE_BYTES,attachmentType,isPreviewImage} from '../src/attachments.js';
test('attachment limits validate the entire selection before writing, including existing media',()=>{
 assert.doesNotThrow(()=>validateFiles([{size:MAX_FILE_BYTES,name:'limit.pdf'}]));assert.throws(()=>validateFiles([{size:MAX_FILE_BYTES+1,name:'big.pdf'}]),/20 MB/);assert.throws(()=>validateFiles([{size:11*1024*1024}], [{blob:{size:40*1024*1024}}]),/50 MB/);assert.doesNotThrow(()=>validateFiles([{size:10*1024*1024}], [{blob:{size:40*1024*1024}}]));assert.throws(()=>validateFiles([{size:NaN}]),/tamaño/);assert.equal(MAX_NOTE_BYTES,50*1024*1024);
});
test('files with missing MIME get usable types and active documents are never inline image previews',()=>{
 assert.equal(attachmentType({name:'Manual.PDF',type:''}),'application/pdf');assert.equal(attachmentType({name:'foto.JPG',type:'application/octet-stream'}),'image/jpeg');assert.equal(attachmentType({name:'audio.MP3',type:''}),'audio/mpeg');assert.equal(attachmentType({name:'unknown.xyz',type:''}),'application/octet-stream');for(const type of ['text/html','image/svg+xml','image/heic','application/pdf'])assert.equal(isPreviewImage(type),false);assert.equal(isPreviewImage('image/png'),true);
});
