<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import SongList from '../components/SongList.vue';
import { useLocalStore } from '../stores/local';
import { usePlayerStore } from '../stores/player';
const local = useLocalStore(); const player = usePlayerStore();
onMounted(() => { void local.init(); }); onBeforeUnmount(() => local.dispose());
async function play(index: number): Promise<void> { await player.playList(local.songs, index); }
</script>
<template>
<div class="offline-view">
<header class="page-head"><div><h1>本地音乐</h1><p>扫描本机音频，离线播放，不上传文件</p></div><button class="primary" @click="local.addDirectory()">＋ 添加目录</button></header>
<section class="directories"><div v-for="dir in local.directories" :key="dir" class="directory"><span class="dir-icon"><svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z" /></svg></span><span class="dir-path">{{ dir }}</span><button title="移除目录" @click="local.removeDirectory(dir)">×</button></div><p v-if="local.directories.length === 0">尚未添加目录。支持 MP3、FLAC、M4A、AAC、OGG、WAV、WMA、APE。</p></section>
<div class="toolbar"><button class="primary" :disabled="local.directories.length === 0" @click="local.scanning ? local.cancel() : local.scan()">{{ local.scanning ? '取消扫描' : '重新扫描' }}</button><span v-if="local.progress">正在扫描 {{ local.progress.current }} / {{ local.progress.total }} · 失败 {{ local.progress.failed }}</span><span v-else-if="local.lastResult" data-testid="scan-result">{{ local.lastResult }}</span><span v-else>{{ local.songs.length }} 首歌曲</span></div>
<div v-if="local.progress" class="progress"><i :style="{ width: (local.progress.total ? local.progress.current / local.progress.total * 100 : 0) + '%' }" /></div>
<div v-if="local.error" class="error">{{ local.error }}</div>
<div class="content"><SongList :songs="local.songs" :loading="local.scanning && local.songs.length === 0" :active-key="player.songKey" :playing="player.playing" empty-text="添加音乐目录后即可播放本地歌曲" @play="play" /></div>
</div>
</template>
<style scoped>
.offline-view{display:flex;flex-direction:column;flex:1;min-height:0;padding:24px 28px 16px;overflow:auto}.page-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}h1{margin:0 0 6px;font-size:25px;color:var(--text-strong)}.page-head p{margin:0;font-size:12px;color:var(--text-muted)}button{cursor:pointer}.primary{height:32px;padding:0 15px;border:0;border-radius:16px;background:var(--accent);color:var(--text-on-accent);font-size:12px}.primary:disabled{opacity:.45}.directories{padding:13px 15px;margin-bottom:14px;border:1px solid var(--app-border);border-radius:var(--radius);background:var(--panel-bg)}.directories>p{margin:0;color:var(--text-muted);font-size:12px;line-height:1.7}.directory{display:flex;align-items:center;gap:10px;min-height:30px}.dir-icon svg{width:17px;height:17px;fill:none;stroke:var(--accent);stroke-width:1.5}.dir-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text)}.directory button{border:0;background:transparent;color:var(--text-muted);font-size:18px}.toolbar{display:flex;align-items:center;gap:14px;min-height:38px;margin-bottom:8px}.toolbar>span{font-size:12px;color:var(--text-muted)}.progress{height:3px;background:var(--panel-hover);margin-bottom:12px}.progress i{display:block;height:100%;background:var(--accent);transition:width .15s}.error{padding:10px 12px;margin-bottom:12px;color:var(--accent);background:var(--accent-dim);border-radius:6px;font-size:12px}.content{flex:1;min-height:0}
</style>