import type { EqualizerConfig } from '../data/config';

export type NeteaseQuality = 'standard' | 'higher' | 'exhigh' | 'lossless';
export type MiguQuality = 'PQ' | 'HQ' | 'SQ';
export interface QualitySettings { netease: NeteaseQuality; migu: MiguQuality }
export interface AppSettings {
  quality: QualitySettings;
  theme: string;
  backgroundPlayback: boolean;
  shortcuts: { desktopLyric: string };
}
export const DEFAULT_SETTINGS: AppSettings = {
  quality: { netease: 'exhigh', migu: 'PQ' },
  theme: 'dark', backgroundPlayback: true,
  shortcuts: { desktopLyric: 'CommandOrControl+Alt+L' },
};
const NE: readonly string[] = ['standard','higher','exhigh','lossless'];
const MG: readonly string[] = ['PQ','HQ','SQ'];
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function mergeSettings(value: unknown): AppSettings {
  const root=object(value), quality=object(root.quality), shortcuts=object(root.shortcuts);
  return {
    quality: {
      netease: NE.includes(String(quality.netease)) ? quality.netease as NeteaseQuality : DEFAULT_SETTINGS.quality.netease,
      migu: MG.includes(String(quality.migu)) ? quality.migu as MiguQuality : DEFAULT_SETTINGS.quality.migu,
    },
    theme: typeof root.theme === 'string' && root.theme ? root.theme : DEFAULT_SETTINGS.theme,
    backgroundPlayback: typeof root.backgroundPlayback === 'boolean' ? root.backgroundPlayback : DEFAULT_SETTINGS.backgroundPlayback,
    shortcuts: { desktopLyric: typeof shortcuts.desktopLyric === 'string' && shortcuts.desktopLyric.trim() ? shortcuts.desktopLyric : DEFAULT_SETTINGS.shortcuts.desktopLyric },
  };
}
export const EQ_FREQUENCIES=[31,62,125,250,500,1000,2000,4000,8000,16000] as const;
export const EQ_PRESETS = [
 {id:'flat',name:'平坦',bands:[0,0,0,0,0,0,0,0,0,0]},
 {id:'bass',name:'低音增强',bands:[9,8,7,5,2,0,-1,-1,0,0]},
 {id:'vocal',name:'人声',bands:[-3,-2,-1,0,3,5,4,2,1,0]},
 {id:'rock',name:'摇滚',bands:[6,5,4,1,-2,-1,2,4,5,5]},
 {id:'pop',name:'流行',bands:[-1,0,1,3,4,3,1,-1,-2,-2]},
] as const;
export type EqualizerSettings = EqualizerConfig & { preset: string };
export function normalizeEqualizer(value: unknown): EqualizerSettings {
 const root=object(value); const oldBands=Array.isArray(root.gains)?root.gains:[];
 const raw=Array.isArray(root.bands)&&root.bands.length?root.bands:oldBands;
 const bands=EQ_FREQUENCIES.map((_,i)=>{
   const oldIndex=Math.min(raw.length-1,Math.round(i*(raw.length-1)/9));
   const n=Number(raw.length===10?raw[i]:raw[oldIndex]);
   return Number.isFinite(n)?Math.max(-12,Math.min(12,n)):0;
 });
 const requested=typeof root.preset==='string'?root.preset:'flat';
 const known=EQ_PRESETS.some(p=>p.id===requested);
 return {enabled:Boolean(root.enabled??root.on),preset:known?requested:'custom',bands};
}
