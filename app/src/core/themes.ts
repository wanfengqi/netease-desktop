export interface ThemeDefinition { id:string; name:string; dark:boolean; vars:Record<string,string> }
const palettes = {
 default:{name:'经典红',dark:false,bg:'#f6f7f9',panel:'#ffffff',hover:'#eef0f4',text:'#1f2329',strong:'#1f2329',muted:'#6b7280',accent:'#c62f2f'},
 dark:{name:'暗夜黑',dark:true,bg:'#1a1b1e',panel:'#232428',hover:'#2c2e33',text:'#a0a4ab',strong:'#e8eaed',muted:'#6b7078',accent:'#e13c3c'},
 sakura:{name:'樱花粉',dark:false,bg:'#fff5f8',panel:'#ffffff',hover:'#ffe9f0',text:'#8a6b78',strong:'#3d2b33',muted:'#b8a0aa',accent:'#ff6b9d'},
 aurora:{name:'极光青',dark:true,bg:'#0e1a1f',panel:'#14242b',hover:'#1b3038',text:'#8bb8b3',strong:'#dff5f2',muted:'#5c8480',accent:'#2ee6c5'},
 paper:{name:'素纸米',dark:false,bg:'#f5f2ea',panel:'#fdfbf6',hover:'#ebe6da',text:'#726c60',strong:'#33302a',muted:'#a39c8d',accent:'#8a6f47'},
 glass:{name:'玻璃蓝',dark:false,bg:'#eef4fb',panel:'#ffffff',hover:'#dde9f7',text:'#5a7186',strong:'#1a2b3d',muted:'#8fa3b8',accent:'#2b7de9'},
} as const;
export function themeVars(id:string): Record<string,string> {
 const p=palettes[id as keyof typeof palettes]??palettes.dark;
 const light=!p.dark;
 return {'--app-bg':p.bg,'--sidebar-bg':p.panel,'--panel-bg':p.panel,'--panel-hover':p.hover,
 '--app-border':light?'rgba(20,30,40,.12)':'rgba(255,255,255,.08)','--text':p.text,'--text-strong':p.strong,'--text-muted':p.muted,
 '--accent':p.accent,'--accent-dim':p.accent+'29','--text-on-accent':'#ffffff','--track-bg':light?'rgba(20,30,40,.12)':'rgba(255,255,255,.1)',
 '--track-buffer':light?'rgba(20,30,40,.2)':'rgba(255,255,255,.16)','--scrollbar-thumb':light?'rgba(20,30,40,.18)':'rgba(255,255,255,.12)',
 '--scrollbar-thumb-hover':p.accent,'--item-hover':light?'rgba(20,30,40,.05)':'rgba(255,255,255,.05)','--item-active':p.accent+'29',
 '--shadow-pop':light?'0 12px 32px rgba(20,30,40,.18)':'0 12px 32px rgba(0,0,0,.55)','--disc-bg-core':p.hover,'--disc-bg-mid':p.panel,
 '--disc-bg-edge':p.bg,'--disc-groove':p.accent+'22','--disc-hole':p.bg,'--shadow-disc':light?'0 24px 60px rgba(20,30,40,.2)':'0 24px 60px rgba(0,0,0,.6)',
 '--overlay-veil':light?'rgba(255,255,255,.5)':'rgba(20,21,26,.5)','--radius':'10px'};
}
export const BUILTIN_THEMES:ThemeDefinition[]=Object.entries(palettes).map(([id,p])=>({id,name:p.name,dark:p.dark,vars:themeVars(id)}));
export function applyTheme(id:string,root:HTMLElement=document.documentElement):ThemeDefinition {
 const theme=BUILTIN_THEMES.find(t=>t.id===id)??BUILTIN_THEMES[1];
 for(const [key,value] of Object.entries(theme.vars)) root.style.setProperty(key,value);
 root.dataset.theme=theme.id; root.style.colorScheme=theme.dark?'dark':'light';
 return theme;
}
export interface Hsl {h:number;s:number;l:number}
export function hexToHsl(hex:string):Hsl|null {
 const m=/^#([0-9a-f]{6})$/i.exec(hex); if(!m)return null;
 const rgb=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255),max=Math.max(...rgb),min=Math.min(...rgb),l=(max+min)/2;
 let h=0,s=0;if(max!==min){const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);const [r,g,b]=rgb;
 h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60;}
 return {h:Math.round(h),s:Math.round(s*100),l:Math.round(l*100)};
}
export function buildThemeFromColor(hex:string):Record<string,string>|null {
 const hsl=hexToHsl(hex);if(!hsl)return null;const dark=hsl.l<50;
 const bg=hslToHex(hsl.h,Math.min(hsl.s,30),dark?10:97);const base=themeVars(dark?'dark':'default');
 return {...base,'--app-bg':bg,'--accent':hex,'--item-active':hex+'29','--accent-dim':hex+'29'};
}
function hslToHex(h:number,s:number,l:number):string {s/=100;l/=100;const k=(n:number)=>(n+h/30)%12,a=s*Math.min(l,1-l),f=(n:number)=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');}
