import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { netease } from '../data/repository';
import type { Comment, Song } from '../data/normalize';
import type { Paged } from '../data/repository/types';

export type CommentTab = 'hot' | 'latest';
export interface CommentsResult extends Paged<Comment> { hot: Comment[] }
export type CommentsApi = (id: string | number, page: number) => Promise<CommentsResult>;

export function appendUnique(existing: readonly Comment[], incoming: readonly Comment[]): Comment[] {
  const seen = new Set(existing.map((item) => item.commentId));
  return [...existing, ...incoming.filter((item) => {
    if (item.commentId === undefined || seen.has(item.commentId)) return false;
    seen.add(item.commentId);
    return true;
  })];
}

export const useCommentsStore = defineStore('comments', () => {
  const items = ref<Comment[]>([]);
  const tab = ref<CommentTab>('hot');
  const loading = ref(false);
  const error = ref('');
  const page = ref(0);
  const hasMore = ref(false);
  const total = ref<number>();
  const songKey = ref('');
  let api: CommentsApi = (id, nextPage) => netease.comments(id, { page: nextPage, limit: 20 });
  let request = 0;

  const count = computed(() => items.value.length);

  function configure(next: CommentsApi): void {
    api = next;
  }

  async function load(song: Song, nextTab: CommentTab = 'hot'): Promise<void> {
    const key = song.source + ':' + String(song.id);
    const same = songKey.value === key && tab.value === nextTab;
    if (same && (loading.value || page.value > 0)) return;
    if (song.source !== 'netease') {
      songKey.value = key;
      items.value = [];
      error.value = '当前仅网易云歌曲支持评论';
      hasMore.value = false;
      return;
    }
    songKey.value = key;
    tab.value = nextTab;
    page.value = 0;
    items.value = [];
    total.value = undefined;
    hasMore.value = false;
    await loadMore();
  }

  async function loadMore(): Promise<void> {
    if (loading.value || (page.value > 0 && !hasMore.value)) return;
    const token = ++request;
    const nextPage = page.value + 1;
    const currentTab = tab.value;
    const id = songKey.value.split(':').slice(1).join(':');
    loading.value = true;
    error.value = '';
    try {
      const result = await api(id, nextPage);
      if (token !== request) return;
      const incoming = currentTab === 'hot' && nextPage === 1 ? result.hot : result.items;
      items.value = appendUnique(items.value, incoming);
      page.value = nextPage;
      hasMore.value = result.hasMore;
      total.value = result.total;
    } catch (err) {
      if (token === request) error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (token === request) loading.value = false;
    }
  }

  function reset(): void {
    request += 1;
    songKey.value = '';
    items.value = [];
    page.value = 0;
    hasMore.value = false;
    total.value = undefined;
    error.value = '';
    loading.value = false;
  }

  return { items, tab, loading, error, page, hasMore, total, songKey, count, configure, load, loadMore, reset };
});
