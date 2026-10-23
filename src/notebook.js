// Notebook pages retain every written character, including crossed-out ink.
export const PAGE_COLUMNS = 40;
export const PAGE_ROWS = 10;
export const PAGE_CAPACITY = PAGE_COLUMNS * PAGE_ROWS;
export const NOTEBOOK_PAGES = 25;
export const NOTEBOOK_SIZES = [25, 50, 100];
export const PAGE_SIZES = [200, 250, 350, 400];
export const notebookFormat = book => ({columns:book.notebook.columns, rows:book.notebook.rows, capacity:book.notebook.columns*book.notebook.rows});
export const isNotebook = note => note?.kind === 'notebook';
export const pageText = page => page.map(ink => ink.char).join('');
export const inkPasses = ink => ink.struck ? ink.passes ?? 1 : 0;
function crossInk(ink) { ink.passes=Math.min(2,inkPasses(ink)+1);ink.struck=true; }
// Consecutive strokes share a curve, but each physical row remains independent.
export function strikeRuns(page,{columns=PAGE_COLUMNS}={}) {
 const runs=[];let row=0,column=0,current=null;
 for(const ink of page){
  if(ink.char==='\n'){row++;column=0;current=null;continue;}
  if(column===columns){row++;column=0;current=null;}
  const passes=inkPasses(ink);
  if(passes){if(current&&current.row===row&&current.passes===passes&&current.end===column)current.end++;
   else {current={row,start:column,end:column+1,passes};runs.push(current);}}
  else current=null;
  column++;
 }
 return runs;
}
export function pageSpace(page, {columns=PAGE_COLUMNS,rows=PAGE_ROWS}={}) {
 let row = 0, column = 0;
 for (const {char} of page) {
  if (char === '\n') { row++; column=0; }
  else { if(column===columns){row++;column=0;} column++; }
  // A trailing line break also needs an available next line for the caret.
  if(row>=rows)return columns*rows+1;
 }
 return row*columns+column;
}
export function validateNotebook(note) {
 if (!isNotebook(note)) return;
 const book = note.notebook;
 if (book?.version !== 1 || !NOTEBOOK_SIZES.includes(book.pageCount) || book.rows !== PAGE_ROWS || ![20,25,35,40].includes(book.columns) || !Array.isArray(book.pages) || book.pages.length > book.pageCount || !book.pages.every(page => Array.isArray(page) && page.length <= book.columns*book.rows && page.every(ink => typeof ink?.char === 'string' && Array.from(ink.char).length === 1 && typeof ink.struck === 'boolean' && (ink.passes===undefined||ink.struck&&[1,2].includes(ink.passes)) && !/[\r\t\u0000-\u0008\u000b-\u001f]/.test(ink.char)) && pageSpace(page,book) <= book.columns*book.rows)) throw Error('El cuaderno tiene un formato inválido.');
}
export function createNotebook(title, {id=crypto.randomUUID(),pageCount=NOTEBOOK_PAGES,capacity=PAGE_CAPACITY}={}) {
 if(!NOTEBOOK_SIZES.includes(pageCount)||!PAGE_SIZES.includes(capacity))throw Error('Elegí un tamaño de cuaderno válido.');
 const time = Date.now();
 return {id, kind:'notebook', title:title.trim() || 'Mi cuaderno', body:'', richBody:'', items:[], labels:[], attachments:[], isList:false, pinned:false, archived:false, deletedAt:null, color:'default', background:'none', createdAt:time, updatedAt:time, order:time, notebook:{version:1,pageCount,columns:capacity/PAGE_ROWS,rows:PAGE_ROWS,pages:[[]]}};
}
// All offsets are Unicode code points. DOM text controls use UTF-16; the UI converts.
export function editPage(page, {start, end = start, text = '', deletion = null, columns=PAGE_COLUMNS, rows=PAGE_ROWS}) {
 start = Math.max(0, Math.min(page.length, start));
 end = Math.max(start, Math.min(page.length, end));
 const result = page.map(ink => ({...ink}));
 if (deletion) {
  if (start === end) {
   if (deletion.includes('Backward')) { while (start > 0 && inkPasses(result[start-1])===2) start--; end = start; if (start > 0) start--; }
   else { while (end < result.length && inkPasses(result[end])===2) end++; start = end; if (end < result.length) end++; }
  }
  for (let i=start;i<end;i++) crossInk(result[i]);
  return {page:result, caret:start};
 }
 const ink = Array.from(text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\u0000-\u0008\u000b-\u001f]/g,'')).map(char => ({char,struck:false}));
 // Paper is immutable in position: selecting old ink is only for crossing it
 // out. Every new character goes after ALL existing ink, including strikes.
 for (let i=start;i<end;i++) crossInk(result[i]);
 result.push(...ink);
 if (pageSpace(result,{columns,rows}) > columns*rows) throw Error('Esta hoja no tiene espacio suficiente. Pasá a la siguiente hoja; lo tachado también ocupa lugar.');
 return {page:result, caret:result.length};
}
