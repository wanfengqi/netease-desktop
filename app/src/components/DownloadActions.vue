<script setup lang="ts">
import { ref } from 'vue';
import type { Song } from '../data/normalize';
import { useDownloadsStore } from '../stores/downloads';
const props = withDefaults(defineProps<{ songs: readonly Song[]; label?: string }>(), { label: '下载' });
const downloads = useDownloadsStore(); const busy = ref(false);
async function run(): Promise<void> { busy.value = true; await downloads.init(); await downloads.start(props.songs); busy.value = false; }
</script>
<template><button type="button" class="download-action" :disabled="busy || songs.length === 0" @click="run"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3" /></svg>{{ busy ? '取址中…' : label }}</button></template>
<style scoped>.download-action{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--app-border);border-radius:15px;background:var(--panel-bg);color:var(--text);font-size:12px;cursor:pointer}.download-action:hover{border-color:var(--accent);color:var(--accent)}.download-action:disabled{opacity:.45;cursor:default}svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}</style>