<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { playModeInfo } from '../core/playmode';
import { EQ_FREQUENCIES, EQ_PRESETS } from '../core/settings';
import { BUILTIN_THEMES } from '../core/themes';
import { useAccountStore } from '../stores/account';
import { useConfigStore } from '../stores/config';
import { usePlayerStore } from '../stores/player';
import { useSettingsStore } from '../stores/settings';
import { useToastStore } from '../stores/toast';
import type { ShortcutStatus } from '../types/api';
const config=useConfigStore(),player=usePlayerStore(),settings=useSettingsStore(),toast=useToastStore(),account=useAccountStore();
const qrStatusText:Record<string,string>={loading:'正在生成二维码…',waiting:'请使用网易云音乐扫码',confirming:'已扫码，请在手机上确认',expired:'二维码已过期，请刷新',error:'二维码暂不可用'};
const versions=ref<{electron:string;chrome:string;node:string;app:string}|null>(null);
const neteaseState=ref('未查询'),miguState=ref('未查询');
const shortcut=ref(settings.settings.shortcuts.desktopLyric),shortcutStatus=ref<ShortcutStatus|null>(null),trayText=ref('未查询');
const downloads=ref<{directory:string;records:{status:string;size:number}[]}|null>(null),localCount=ref('未提供');
const qualityHint=ref('音质从下一次在线取址生效；当前歌曲不会自动重载。');
const neQuality=[['standard','标准'],['higher','较高'],['exhigh','极高'],['lossless','无损']];
const mgQuality=[['PQ','PQ · 普通'],['HQ','HQ · 高清'],['SQ','SQ · 无损']];
function quality(source:'netease'|'migu',event:Event):void {settings.setQuality(source,(event.target as HTMLSelectElement).value);qualityHint.value='已保存：下一次在线取址生效；当前歌曲不会自动重载。';}
function mode(event:Event):void {const value=(event.target as HTMLSelectElement).value as typeof player.mode;player.player?.setMode(value);config.setPlayMode(value);}
function changeVolume(event:Event):void {player.setVolume(Number((event.target as HTMLInputElement).value)/100);}
async function saveShortcut():Promise<void> {const result=await window.api.system.setLyricShortcut(shortcut.value);if(result.ok){settings.setLyricShortcut(shortcut.value);toast.push('桌面歌词快捷键已生效');}else toast.push(result.error,'error');await loadShortcutStatus();}
async function loadShortcutStatus():Promise<void> {shortcutStatus.value=await window.api.system.shortcutStatus();}
async function chooseDownloadDirectory():Promise<void> {const directory=await window.api.dialog.chooseDirectory('选择下载目录');if(directory)downloads.value=await window.api.downloads.setDirectory(directory);}
watch(()=>settings.equalizer,(value)=>player.updateEqualizer(value),{deep:true});
onMounted(async()=>{
 await account.refresh();
 versions.value=await window.api.app.versions();
 try{const s=await window.api.netease.status?.();neteaseState.value=s?(s.ready?'就绪 · 端口 '+s.port:'未就绪'):'不可用';}catch(e){neteaseState.value=e instanceof Error?e.message:String(e);}
 try{const s=await window.api.miguStatus?.();miguState.value=s?.ready?'就绪':'未就绪';}catch(e){miguState.value=e instanceof Error?e.message:String(e);}
 await loadShortcutStatus();const tray=await window.api.system.trayStatus();trayText.value=tray.ok?'已创建 · '+tray.menuItems.join(' / '):'不可用：'+tray.error;
 try{downloads.value=await window.api.downloads.list();}catch{}
});
</script>
<template>
<div class="settings-view">
 <section class="st-card account-card"><h3>网易云账号</h3>
  <div v-if="account.profile.loggedIn" class="account-profile" data-testid="account-profile"><div><strong>{{account.profile.nickname||'网易云用户'}}</strong><span>用户 ID：{{account.profile.userId}}</span></div><button data-testid="logout" @click="account.logout">退出登录</button></div>
  <div v-else><div class="st-row"><span>{{account.hasCookie?'已有登录凭据，正在验证':'扫码登录网易云音乐'}}</span><button v-if="account.hasCookie" @click="account.refresh">重新验证</button><button v-else data-testid="refresh-qr" @click="account.createQr">{{account.qrImage?'刷新二维码':'生成二维码'}}</button></div>
   <div v-if="account.qrImage" class="account-qr"><img :src="account.qrImage" alt="网易云登录二维码" width="180" height="180"><div><strong>{{qrStatusText[account.qrStatus]}}</strong><p>{{account.qrMessage}}</p><button v-if="account.qrStatus==='expired'||account.qrStatus==='error'" data-testid="refresh-qr" @click="account.createQr">刷新二维码</button></div></div>
  </div>
  <p v-if="account.error" class="st-note st-error">账号状态查询失败：{{account.error}}。登录凭据已保留，可稍后重试。</p>
 </section>
 <section class="st-card"><h3>播放</h3>
  <label class="st-row"><span>默认音源</span><select :value="config.source" @change="config.setSource(($event.target as HTMLSelectElement).value as 'netease'|'migu')"><option value="netease">网易云</option><option value="migu">咪咕</option></select></label>
  <label class="st-row"><span>网易云音质</span><select data-testid="ne-quality" :value="settings.settings.quality.netease" @change="quality('netease',$event)"><option v-for="q in neQuality" :key="q[0]" :value="q[0]">{{q[1]}}</option></select></label>
  <label class="st-row"><span>咪咕音质</span><select data-testid="mg-quality" :value="settings.settings.quality.migu" @change="quality('migu',$event)"><option v-for="q in mgQuality" :key="q[0]" :value="q[0]">{{q[1]}}</option></select></label>
  <p class="st-note">{{qualityHint}} 实际音质以服务端返回为准，不会假装升音质。</p>
  <label class="st-row"><span>播放模式</span><select :value="player.mode" @change="mode"><option v-for="m in ['list','one','shuffle','order']" :key="m" :value="m">{{playModeInfo(m as typeof player.mode).label}}</option></select></label>
  <label class="st-row"><span>音量 / 静音</span><span class="st-control"><input type="range" min="0" max="100" :value="Math.round(player.volume*100)" @input="changeVolume"><button @click="player.toggleMute">{{player.muted?'取消静音':'静音'}}</button></span></label>
  <label class="st-row" title="关闭后窗口隐藏时暂停，重新显示时恢复"><span>后台播放状态</span><input type="checkbox" :checked="settings.settings.backgroundPlayback" @change="settings.setBackgroundPlayback(($event.target as HTMLInputElement).checked)"></label>
 </section>
 <section class="st-card"><h3>均衡器 · 10 段</h3>
  <div class="st-row"><label><input data-testid="eq-enabled" type="checkbox" :checked="settings.equalizer.enabled" @change="settings.setEqualizer({enabled:($event.target as HTMLInputElement).checked})"> 启用均衡器</label><span>仅网易云跨源支持时生效</span></div>
  <div class="eq-presets"><button v-for="p in EQ_PRESETS" :key="p.id" :class="{active:settings.equalizer.preset===p.id}" @click="settings.setPreset(p.id)">{{p.name}}</button><button @click="settings.resetEqualizer">重置</button></div>
  <div class="eq-bands"><label v-for="(f,i) in EQ_FREQUENCIES" :key="f"><input type="range" min="-12" max="12" step="1" :value="settings.equalizer.bands[i]" :aria-label="f+' Hz'" @input="settings.setBand(i,Number(($event.target as HTMLInputElement).value))"><b>{{settings.equalizer.bands[i]}} dB</b><span>{{f>=1000?f/1000+'k':f}}</span></label></div>
  <p class="st-note" :class="{'st-error':player.equalizerState.error}">{{player.equalizerState.error || (player.equalizerState.active?'Web Audio 已连接 · '+player.equalizerState.gains.join(', '):'等待网易云在线音频；异常自动回退，最多重载 1 次。')}}</p>
 </section>
 <section class="st-card"><h3>主题</h3><div class="theme-grid"><button v-for="theme in BUILTIN_THEMES" :key="theme.id" class="theme" :data-theme-id="theme.id" :class="{active:settings.settings.theme===theme.id}" @click="settings.setTheme(theme.id)"><span class="swatches"><i v-for="key in ['--app-bg','--panel-bg','--accent']" :key="key" :style="{background:theme.vars[key]}"></i></span>{{theme.name}}</button></div></section>
 <section class="st-card"><h3>快捷键与系统</h3>
  <div class="st-row"><span>系统媒体键</span><span class="st-mono">{{Object.entries(shortcutStatus?.media??{}).map(([k,v])=>k+': '+(v.ok?'已注册':v.error)).join('；')||'查询中'}}</span></div>
  <label class="st-row"><span>桌面歌词</span><span class="st-control"><input v-model="shortcut" placeholder="Ctrl+Alt+L"><button data-testid="save-shortcut" @click="saveShortcut">应用</button></span></label>
  <div class="st-row"><span>歌词快捷键状态</span><span :class="{'st-error':!shortcutStatus?.desktopLyric.ok}">{{shortcutStatus?.desktopLyric.ok?'已注册':'注册失败 / 未就绪'}} {{shortcutStatus?.desktopLyric.error}}</span></div>
  <div class="st-row"><span>托盘菜单</span><span>{{trayText}}</span></div>
 </section>
 <section class="st-card"><h3>下载 / 存储</h3><div class="st-row"><span>下载目录</span><span class="st-control st-mono">{{downloads?.directory||'未提供'}}<button @click="chooseDownloadDirectory">更改</button></span></div><div class="st-row"><span>下载记录</span><span>{{downloads?downloads.records.length+' 条 · 完成 '+downloads.records.filter(r=>r.status==='completed').length+' 条 · 已下载 '+(downloads.records.filter(r=>r.status==='completed').reduce((n,r)=>n+r.size,0)/1048576).toFixed(1)+' MB':'未提供'}}</span></div><div class="st-row"><span>缓存 / 本地库占用</span><span>{{localCount}}（没有准确测量接口，不估算）</span></div></section>
 <section class="st-card"><h3>关于</h3><div class="st-row"><span>版本</span><span class="st-mono">{{versions?.app||'未知'}} · Electron {{versions?.electron}} · Chromium {{versions?.chrome}}</span></div><div class="st-row"><span>网易云后端</span><span>{{neteaseState}}</span></div><div class="st-row"><span>咪咕后端</span><span>{{miguState}}</span></div><div class="st-row"><span>配置</span><span>{{config.saving?'保存中':'统一防抖 400ms · '+(config.error||'正常')}}</span></div></section>
</div>
</template>
<style scoped>
.account-profile{display:flex;align-items:center;justify-content:space-between}.account-profile div{display:flex;flex-direction:column;gap:6px}.account-profile strong{color:var(--text-strong);font-size:16px}.account-profile span{color:var(--text-muted);font-size:12px}.account-qr{display:flex;align-items:center;gap:20px;margin-top:12px}.account-qr img{display:block;background:#fff;border-radius:8px;padding:5px}.account-qr strong{font-size:13px;color:var(--text-strong)}.account-qr p{font-size:12px;color:var(--text-muted)}.settings-view{flex:1;min-height:0;overflow-y:auto;padding:18px 24px 30px;display:flex;flex-direction:column;gap:14px}.st-card{padding:16px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--app-border)}h3{margin:0 0 10px;color:var(--text-strong);font-size:14px}.st-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:7px 0;font-size:12px}.st-row>span:first-child{color:var(--text-muted)}.st-control{display:flex;gap:8px;align-items:center;max-width:70%;text-align:right}.st-mono{font-family:Consolas,monospace;font-size:11px;word-break:break-word}select,input,button{font:inherit;color:var(--text);background:var(--panel-hover);border:1px solid var(--app-border);border-radius:6px;padding:5px 8px}button{cursor:pointer}button:hover,button.active{border-color:var(--accent);color:var(--accent)}input[type=range]{accent-color:var(--accent);padding:0}.st-note{font-size:11px;color:var(--text-muted);margin:6px 0}.st-error{color:var(--accent)}.theme-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.theme{display:flex;gap:10px;align-items:center;padding:12px}.swatches{display:flex}.swatches i{display:block;width:22px;height:22px;border-radius:50%;border:1px solid var(--app-border);margin-right:-5px}.eq-presets{display:flex;gap:8px;flex-wrap:wrap}.eq-bands{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin-top:16px}.eq-bands label{display:flex;align-items:center;gap:6px;flex-direction:column;font-size:10px}.eq-bands input{writing-mode:vertical-lr;direction:rtl;width:24px;height:110px}.eq-bands b{font-weight:400;color:var(--text-strong);white-space:nowrap}@media(max-width:950px){.eq-bands{grid-template-columns:repeat(5,1fr)}.eq-bands input{height:65px}}
</style>