/**
 * 配置 store（S3）。
 *
 * 修旧 2.5「两套落盘节流不对称」：旧版 recordRecent 每次 playAt 立刻整表同步写盘，
 * 队列却防抖 800ms。这里只留**一个**防抖写盘通道 —— 任何字段的写入都走它，
 * 谁也不能绕过（flush() 是唯一例外，给关窗口时用）。
 *
 * 队列的当前曲用一个**单独**的 key 落盘（extra.queueKey），配合 config.queue 一起恢复：
 * 旧格式只有 queue + queueIndex，索引在队列变化后不可信（旧 2.6）。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { NextConfig } from '../data/config';
import type { Song } from '../data/normalize';

/** 统一防抖间隔：所有字段共用一个计时器，连续操作只写一次盘 */
const WRITE_DEBOUNCE_MS = 400;

/** 落在 extra 里的、新壳自己用的键（storage 层只认识旧 13 键，新键走 extra 不污染 schema） */
const EXTRA_QUEUE_KEY = 'queueKey';

export interface ConfigApiLike {
  load(): Promise<NextConfig>;
  save(patch: Partial<NextConfig>): Promise<NextConfig>;
}

function bridge(): ConfigApiLike | null {
  const api = (globalThis as unknown as { window?: { api?: { config?: ConfigApiLike } } }).window?.api;
  return api?.config ?? null;
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<NextConfig | null>(null);
  const loaded = ref(false);
  const error = ref('');
  const saving = ref(false);

  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 待写入的补丁：多次调用会合并，保证"最后一次意图"胜出 */
  let pending: Partial<NextConfig> = {};

  const cookie = computed(() => config.value?.cookie ?? '');
  const source = computed(() => config.value?.source ?? 'netease');
  const searchHistory = computed<string[]>(() => config.value?.searchHistory ?? []);
  const favorites = computed<Song[]>(() => config.value?.favorites ?? []);
  const recent = computed<Song[]>(() => config.value?.recent ?? []);
  const volume = computed(() => config.value?.volume ?? 0.8);
  const muted = computed(() => config.value?.muted ?? false);
  const playMode = computed(() => config.value?.playMode ?? 'list');
  const storedQueue = computed<Song[]>(() => config.value?.queue ?? []);
  const storedQueueKey = computed(() => {
    const raw = config.value?.extra?.[EXTRA_QUEUE_KEY];
    return typeof raw === 'string' ? raw : '';
  });

  async function load(): Promise<void> {
    if (loaded.value) return;
    const api = bridge();
    if (!api) {
      error.value = 'window.api.config 不可用（非 Electron 环境）';
      loaded.value = true;
      return;
    }
    try {
      config.value = await api.load();
      loaded.value = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      loaded.value = true;
    }
  }

  /** 只改内存，不动盘子（调用方随后调 touch() 或直接在 update 里合并） */
  function patchLocal(patch: Partial<NextConfig>): void {
    if (!config.value) return;
    config.value = { ...config.value, ...patch };
  }

  /** 统一写盘入口：合并补丁 + 防抖 */
  function update(patch: Partial<NextConfig>): void {
    patchLocal(patch);
    pending = { ...pending, ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, WRITE_DEBOUNCE_MS);
  }

  /** 立即写盘（关窗口 / 切歌这类"丢了会难受"的时刻由调用方显式触发） */
  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const api = bridge();
    const body = pending;
    pending = {};
    if (!api || Object.keys(body).length === 0) return;
    saving.value = true;
    try {
      config.value = await api.save(body);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      saving.value = false;
    }
  }

  /** 队列 + 当前曲 key 一起写（key 放 extra，旧 schema 不用改） */
  function saveQueue(songs: Song[], currentKey: string): void {
    if (!config.value) return;
    const extra = { ...config.value.extra, [EXTRA_QUEUE_KEY]: currentKey };
    update({ queue: songs, extra });
  }

  function setSearchHistory(words: string[]): void {
    update({ searchHistory: words.slice(0, 20) });
  }

  function pushSearchHistory(word: string): void {
    const trimmed = word.trim();
    if (!trimmed) return;
    const rest = searchHistory.value.filter((w) => w !== trimmed);
    update({ searchHistory: [trimmed, ...rest].slice(0, 20) });
  }

  function setVolume(volume: number, muted: boolean): void {
    update({ volume, muted });
  }

  function setPlayMode(mode: NextConfig['playMode']): void {
    update({ playMode: mode });
  }

  function setSource(next: NextConfig['source']): void {
    update({ source: next });
  }

  function dispose(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    config,
    loaded,
    error,
    saving,
    cookie,
    source,
    searchHistory,
    favorites,
    recent,
    volume,
    muted,
    playMode,
    storedQueue,
    storedQueueKey,
    load,
    patchLocal,
    update,
    flush,
    saveQueue,
    setSearchHistory,
    pushSearchHistory,
    setVolume,
    setPlayMode,
    setSource,
    dispose,
  };
});
