/**
 * 视图栈（S3）—— 不引入 vue-router，但要支持"从搜索进歌单 → 返回搜索"。
 *
 * 设计：侧栏 4 项是**根视图**（切换根视图会清空栈），
 * 点歌单/专辑/歌手是**压栈子视图**，返回按钮弹一层。
 * 栈深上限 20：足够表达"搜索→歌手→专辑"，又不至于让返回键变成迷宫。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Album, Artist, Playlist } from '../data/normalize';
import type { NavKey } from '../nav';

export type ViewRoute =
  | { name: 'home' }
  | { name: 'discover' }
  | { name: 'player' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'settings' }
  | { name: 'playlist'; playlist: Playlist }
  | { name: 'album'; album: Album }
  | { name: 'artist'; artist: Artist };

const STACK_LIMIT = 20;

/** 根视图表：侧栏切过来时不带 payload */
const NAV_ROUTES: Record<NavKey, ViewRoute> = {
  home: { name: 'home' },
  discover: { name: 'discover' },
  search: { name: 'search' },
  library: { name: 'library' },
  settings: { name: 'settings' },
};

export const useNavigationStore = defineStore('navigation', () => {
  const stack = ref<ViewRoute[]>([{ name: 'home' }]);

  const current = computed<ViewRoute>(() => stack.value[stack.value.length - 1] ?? { name: 'home' });
  const depth = computed(() => stack.value.length);
  const canGoBack = computed(() => stack.value.length > 1);
  /** 侧栏高亮：沿栈向下找到最近的根视图 */
  const activeNav = computed<NavKey>(() => {
    for (let i = stack.value.length - 1; i >= 0; i -= 1) {
      const name = stack.value[i].name;
      if (name === 'home' || name === 'discover' || name === 'search' || name === 'library' || name === 'settings') return name;
    }
    return 'home';
  });

  /** 切根视图：清栈（否则返回会回到别的根，很迷惑） */
  function goNav(key: NavKey): void {
    stack.value = [NAV_ROUTES[key]];
  }

  function push(route: ViewRoute): void {
    const next = [...stack.value, route];
    stack.value = next.length > STACK_LIMIT ? next.slice(next.length - STACK_LIMIT) : next;
  }

  function openPlayer(): void {
    push({ name: 'player' });
  }

  function openPlaylist(playlist: Playlist): void {
    push({ name: 'playlist', playlist });
  }

  function openAlbum(album: Album): void {
    push({ name: 'album', album });
  }

  function openArtist(artist: Artist): void {
    push({ name: 'artist', artist });
  }

  function back(): void {
    if (stack.value.length <= 1) return;
    stack.value = stack.value.slice(0, -1);
  }

  return {
    stack,
    current,
    depth,
    canGoBack,
    activeNav,
    goNav,
    push,
    openPlayer,
    openPlaylist,
    openAlbum,
    openArtist,
    back,
  };
});
