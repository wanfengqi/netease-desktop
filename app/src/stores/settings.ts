import {computed,watch} from 'vue';
import {defineStore} from 'pinia';
import {useConfigStore} from './config';
import {mergeSettings,normalizeEqualizer,EQ_PRESETS,type AppSettings} from '../core/settings';
import {applyTheme} from '../core/themes';
export const useSettingsStore=defineStore('settings',()=>{
 const config=useConfigStore();
 const settings=computed(()=>mergeSettings(config.config?.extra?.settings));
 const equalizer=computed(()=>normalizeEqualizer(config.config?.equalizer));
 function save(patch:Partial<AppSettings>):void {
  const next={...settings.value,...patch};
  config.update({extra:{...config.config?.extra,settings:next}});
 }
 function setQuality(source:'netease'|'migu',value:string):void {save({quality:{...settings.value.quality,[source]:value}});}
 function setTheme(id:string):void {applyTheme(id);save({theme:id});}
 function setBackgroundPlayback(value:boolean):void {save({backgroundPlayback:value});}
 function setLyricShortcut(value:string):void {save({shortcuts:{desktopLyric:value}});}
 function setEqualizer(patch:Partial<ReturnType<typeof normalizeEqualizer>>):void {
  config.update({equalizer:normalizeEqualizer({...equalizer.value,...patch})});
 }
 function setBand(index:number,gain:number):void {const bands=[...equalizer.value.bands];bands[index]=gain;setEqualizer({bands,preset:'custom',enabled:true});}
 function setPreset(id:string):void {const p=EQ_PRESETS.find(x=>x.id===id);if(p)setEqualizer({bands:[...p.bands],preset:id});}
 function resetEqualizer():void {setPreset('flat');}
 watch(()=>config.config?.extra?.settings,()=>applyTheme(settings.value.theme),{immediate:true,deep:true});
 return {settings,equalizer,save,setQuality,setTheme,setBackgroundPlayback,setLyricShortcut,setEqualizer,setBand,setPreset,resetEqualizer};
});
