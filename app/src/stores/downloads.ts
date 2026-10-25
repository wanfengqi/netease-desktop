import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { migu, netease } from '../data/repository/index';
import type { SongUrlResult } from '../data/source';
async function resolveDownloadUrl(song: Song): Promise<SongUrlResult> {
  if (song.source === 'local') return { url: null, reason: '已是本地文件', level: 'local', auditionMs: 0 };
  const play = song.source === 'migu' ? await migu.songUrl(song) : await netease.songUrl(song.id);
  return { url: play.url, reason: play.reason, level: play.level, auditionMs: play.auditionMs };
}
import type { Song } from '../data/normalize';
import type { DownloadRecord } from '../types/offline';
export const useDownloadsStore = defineStore('downloads', () => {
  const directory = ref(''); const records = ref<DownloadRecord[]>([]); const loading = ref(false); const error = ref(''); const initialized = ref(false); let unsubscribe: (() => void) | null = null;
  const completed = computed(() => records.value.filter((x) => x.status === 'completed').map((x) => x.song));
  function apply(state: { directory: string; records: DownloadRecord[] }): void { directory.value = state.directory; records.value = state.records; }
  async function init(): Promise<void> { if (initialized.value) return; if (!unsubscribe) unsubscribe = window.api.downloads.onProgress(({ record }) => { const index = records.value.findIndex((x) => x.id === record.id); if (index < 0) records.value.push(record); else records.value[index] = record; }); const state = await window.api.downloads.list(); apply(state); initialized.value = true; }
  async function chooseDirectory(selected?: string): Promise<void> { const chosen = selected || await window.api.dialog.chooseDirectory('选择下载目录'); if (!chosen) return; const state = await window.api.downloads.setDirectory(chosen); if (!state.ok) { error.value = state.error || '设置下载目录失败'; return; } apply(state); }
  async function start(songs: readonly Song[]): Promise<void> { error.value = ''; loading.value = true; const items = []; const failed = []; for (const song of songs) { if (song.source === 'local') { failed.push(song.name + ' 已是本地文件'); continue; } const result = await resolveDownloadUrl(song); if (result.url && /^https?:/.test(result.url)) items.push({ song, url: result.url }); else failed.push(song.name + '：' + (result.reason || '无下载地址')); } if (items.length) { const state = await window.api.downloads.start(items); if (!state.ok) error.value = state.error || '启动下载失败'; else apply(state); } if (failed.length) error.value = failed.join('；'); loading.value = false; }
  async function retry(record: DownloadRecord): Promise<void> { const result = await resolveDownloadUrl(record.song); if (!result.url) { error.value = result.reason || '重新取址失败'; return; } const state = await window.api.downloads.retry(record.id, result.url); if (!state.ok) error.value = state.error || '重试失败'; else apply(state); }
  async function cancel(id: string): Promise<void> { await window.api.downloads.cancel(id); }
  async function remove(id: string, deleteFile: boolean): Promise<void> { const state = await window.api.downloads.remove(id, deleteFile); if (!state.ok) error.value = state.error || '删除失败'; else apply(state); }
  function dispose(): void { unsubscribe?.(); unsubscribe = null; }
  return { directory, records, loading, error, initialized, completed, init, chooseDirectory, start, retry, cancel, remove, dispose };
});
