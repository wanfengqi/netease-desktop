/**
 * 搜索 store（S3）—— 状态 / 三分栏结果 / 搜索历史 / **请求序号**。
 *
 * 请求序号是这一层的存在理由：用户打字快的时候三次搜索会并发在途，
 * 后发的先回、先发的后回，结果就会闪一下旧数据再变（表现像"搜索框吞字"）。
 * 旧版没有序号保护；这里每次搜索自增 seq，回包时 seq 不是当前值就整包丢弃。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Album, Artist, Playlist, Song } from '../data/normalize';
import { searchAll } from '../data/source';
import { useConfigStore } from './config';

export type SearchTab = 'songs' | 'playlists' | 'artists';

export interface SearchState {
  keyword: string;
  songs: Song[];
  playlists: Playlist[];
  artists: Artist[];
  albums: Album[];
}

export const useSearchStore = defineStore('search', () => {
  const config = useConfigStore();

  const keyword = ref('');
  const submitted = ref('');
  const tab = ref<SearchTab>('songs');
  const songs = ref<Song[]>([]);
  const playlists = ref<Playlist[]>([]);
  const artists = ref<Artist[]>([]);
  const loading = ref(false);
  const error = ref('');
  const history = computed<string[]>(() => config.searchHistory);

  /** 单调递增的请求序号：只有最新一次搜索的结果能落地 */
  let seq = 0;

  const hasResults = computed(
    () => songs.value.length > 0 || playlists.value.length > 0 || artists.value.length > 0,
  );
  const isEmpty = computed(() => !loading.value && submitted.value !== '' && !hasResults.value);

  const counts = computed(() => ({
    songs: songs.value.length,
    playlists: playlists.value.length,
    artists: artists.value.length,
  }));

  function clear(): void {
    songs.value = [];
    playlists.value = [];
    artists.value = [];
    error.value = '';
    submitted.value = '';
  }

  /**
   * 执行搜索。返回的 promise 在**被更新的一次搜索取代**时也会正常结束，
   * 只是不写任何结果（调用方不需要额外处理）。
   */
  async function search(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      clear();
      return;
    }
    seq += 1;
    const mine = seq;

    submitted.value = trimmed;
    keyword.value = trimmed;
    loading.value = true;
    error.value = '';

    try {
      const buckets = await searchAll(config.source, trimmed);
      if (mine !== seq) return; // 过期响应：整包丢弃
      songs.value = buckets.songs;
      playlists.value = buckets.playlists;
      artists.value = buckets.artists;
      // 空栏自动切到有内容的那一栏，省一次点击
      if (buckets.songs.length === 0) {
        if (buckets.playlists.length > 0) tab.value = 'playlists';
        else if (buckets.artists.length > 0) tab.value = 'artists';
      }
    } catch (err) {
      if (mine !== seq) return;
      error.value = err instanceof Error ? err.message : String(err);
      songs.value = [];
      playlists.value = [];
      artists.value = [];
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  /** 提交并记入历史 */
  async function submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    config.pushSearchHistory(trimmed);
    await search(trimmed);
  }

  /** 每次自增一个真序号（测试用：断言过期响应真的不会落地） */
  function currentSeq(): number {
    return seq;
  }

  return {
    keyword,
    submitted,
    tab,
    songs,
    playlists,
    artists,
    loading,
    error,
    history,
    hasResults,
    isEmpty,
    counts,
    clear,
    search,
    submit,
    currentSeq,
  };
});
