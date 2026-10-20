// IndexedDB is authoritative; this small mirror is only for the first paint.
export function applyThemePreference(value='system',env=globalThis){
 const theme=['light','dark','system'].includes(value)?value:'system';
 const dark=theme==='dark'||theme==='system'&&env.matchMedia('(prefers-color-scheme: dark)').matches;
 env.document.documentElement.dataset.theme=dark?'dark':'light';
 env.document.body.classList.toggle('dark',dark);
 env.document.querySelector('meta[name=theme-color]').content=dark?'#202124':'#ffffff';
 try{env.localStorage.setItem('guarda-theme',theme);}catch{}
}
