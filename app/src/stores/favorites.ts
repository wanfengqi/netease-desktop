/**
 * 收藏 store（S6）。
 *
 * 铁律：收藏去重**只认 Norm.key() = `source:id`**，绝不按 id 或数组下标。
 * 理由（S1 已写进 normalize.ts）：网易云 id=123 与咪咕 id=123 是两首完全不同的歌，
 * 按 id 去重会把它们合成一首；按索引去重则一换列表就全错。
 *
 * 状态放在本地 ref，同时**镜像**写进 config store 的 favorites 字段（走统一的 400ms 防抖通道）。
 * 这样即使配置还没加载完（App.vue 的 config.load 是异步的），UI 也已可用且不会丢操作。
 */
import { defineStore } from 'pinia';
import { computed, shallowRef, watch } from 'vue';
import { key as songKey } from '../data/normalize';
import type { Song } from '../data/normalize';
import { useConfigStore } from './config';

/** 按 key 去重，保留首次出现的顺序（收藏的排序 = 用户收藏的先后） */
export function dedupeSongs(list: readonly Song[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const song of list) {
    const k = songKey(song);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(song);
  }
  return out;
}

export function isFavorite(list: readonly Song[], target: Song | string): boolean {
  const k = typeof target === 'string' ? target : songKey(target);
  if (!k) return false;
  return list.some((song) => songKey(song) === k);
}

export interface ToggleResult {
  songs: Song[];
  /** 这次操作后是否处于"已收藏" */
  favorited: boolean;
}

/** 收藏/取消收藏。同一 key 加两次只会有一条。 */
export function toggleFavorite(list: readonly Song[], song: Song): ToggleResult {
  const k = songKey(song);
  if (!k) return { songs: [...list], favorited: false };
  if (isFavorite(list, k)) {
    return { songs: list.filter((s) => songKey(s) !== k), favorited: false };
  }
  return { songs: [song, ...dedupeSongs(list)], favorited: true };
}

/** 按 key 移除（歌单/历史里的行被删时用这个，比传整首 Song 稳） */
export function removeFavorites(list: readonly Song[], keys: readonly string[]): Song[] {
  const drop = new Set(keys);
  return list.filter((song) => !drop.has(songKey(song)));
}

/**
 * 把 Vue 的响应式代理拆成普通对象。**进入和离开 store 都要拆**。
 *
 * 踩到的真坑（两次，同一个根源）：
 *   TypeError: An object could not be cloned.
 * ① 把 shallowRef 里的对象直接交给 config.update() 时；
 * ② 更隐蔽的一路：config.value 是**深度 ref**，从它读出来的每首歌都是 Vue 代理。
 *    这些代理一旦流进 player 的队列，player.persistQueue() 经 IPC 写盘就抛上面的错，
 *    表现是"歌能播，但队列永远存不下来"。
 *
 * 所以这里定两条规矩：
 *   · 外面进来的（config → songs）先 toPlain 再存，内存里只放普通对象；
 *   · 写出去的一律 toPlain，绝不把代理交给 IPC。
 * 配置里都是纯 JSON，JSON 往返无损（只丢 undefined 键）。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 挂在播放列表上的收藏状态集合（O(1) 查询，模板里逐行判断不用每次遍历） */
export const useFavoritesStore = defineStore('favorites', () => {
  const config = useConfigStore();
  /**
   * shallowRef 而不是 ref：Song 对象必须保持**普通对象**。
   * 深度 ref 会把每首歌包成 Vue 代理，代理无法structured-clone，
   * player.persistQueue() 经 IPC 写盘时会抛 "An object could not be cloned."。
   * 数组整体替换已经足够触发响应式，元素级深层代理没有必要。
   */
  const songs = shallowRef<Song[]>([]);

  /**
   * 配置到达 / 被外部改写时同步进来。
   * 自己写出去的那一次会回灌一遍（内容相同），dedupeSongs 幂等，不会形成循环。
   */
  watch(
    () => config.favorites,
    (list) => {
      // toPlain 在这里不是可选项：不拆代理，后续 playList 会把代理带进队列
      songs.value = dedupeSongs(toPlain(list));
    },
    { immediate: true, deep: false },
  );

  const keys = computed<ReadonlySet<string>>(() => new Set(songs.value.map((s) => songKey(s))));
  const count = computed(() => songs.value.length);

  function persist(next: Song[]): void {
    songs.value = next;
    config.update({ favorites: toPlain(next) });
  }

  function has(target: Song | string | null | undefined): boolean {
    if (!target) return false;
    const k = typeof target === 'string' ? target : songKey(target);
    return k !== '' && keys.value.has(k);
  }

  /** 返回操作后的状态；缺 id 的歌无法收藏（拿不到稳定身份） */
  function toggle(song: Song): boolean {
    const result = toggleFavorite(songs.value, song);
    if (result.songs === songs.value) return has(song);
    persist(result.songs);
    return result.favorited;
  }

  function add(song: Song): boolean {
    const k = songKey(song);
    if (!k || keys.value.has(k)) return false;
    persist([song, ...songs.value]);
    return true;
  }

  function remove(target: Song | string): void {
    const k = typeof target === 'string' ? target : songKey(target);
    if (!k) return;
    persist(removeFavorites(songs.value, [k]));
  }

  function clear(): void {
    persist([]);
  }

  return { songs, keys, count, has, toggle, add, remove, clear };
});
