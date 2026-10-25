import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Song } from '../data/normalize';
import type { ScanProgress } from '../types/offline';
export const useLocalStore = defineStore('local', () => {
  const directories = ref<string[]>([]); const songs = ref<Song[]>([]); const scanning = ref(false); const progress = ref<ScanProgress | null>(null); const error = ref(''); const initialized = ref(false); const lastResult = ref('');
  let unsubscribe: (() => void) | null = null;
  async function refresh(): Promise<void> { const state = await window.api.local.state(); if (!state.ok) { error.value = state.error || '读取本地曲库失败'; return; } directories.value = state.directories; songs.value = state.songs; scanning.value = state.scanning; progress.value = state.progress; initialized.value = true; }
  async function init(): Promise<void> { if (initialized.value) return; if (!unsubscribe) unsubscribe = window.api.local.onProgress((value) => { progress.value = value; scanning.value = !value.cancelled; }); await refresh(); }
  async function addDirectory(directory?: string): Promise<void> { const chosen = directory || await window.api.dialog.chooseDirectory('添加本地音乐目录'); if (!chosen) return; error.value = ''; const state = await window.api.local.addDirectory(chosen); if (!state.ok) { error.value = state.error || '添加目录失败'; return; } directories.value = state.directories; await scan(); }
  async function removeDirectory(directory: string): Promise<void> { const state = await window.api.local.removeDirectory(directory); if (!state.ok) { error.value = state.error || '移除目录失败'; return; } directories.value = state.directories; songs.value = state.songs; }
  async function scan(): Promise<void> { if (scanning.value) return; error.value = ''; scanning.value = true; const result = await window.api.local.scan(); scanning.value = false; progress.value = null; if (!result.ok) { error.value = result.error || '扫描失败'; return; } directories.value = result.directories; songs.value = result.songs; lastResult.value = result.cancelled ? '扫描已取消' : '扫描完成：' + result.total + ' 个音频，成功 ' + (result.total - result.failed) + '，失败 ' + result.failed + '，增量复用 ' + result.reused; }
  async function cancel(): Promise<void> { await window.api.local.cancel(); }
  function dispose(): void { unsubscribe?.(); unsubscribe = null; }
  return { directories, songs, scanning, progress, error, initialized, lastResult, init, refresh, addDirectory, removeDirectory, scan, cancel, dispose };
});
