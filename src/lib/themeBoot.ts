// kept apart from theme.ts, the layout (a server component) needs this without react hooks
export const THEME_KEY = 'theme';

// inline in <head>, so a picked theme is there before the first paint
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
