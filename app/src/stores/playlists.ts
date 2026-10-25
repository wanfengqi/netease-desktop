/**
 * 歌单 store（S6）—— 用户自己的歌单：CRUD + 加歌/移歌/排序。
 *
 * 两类歌单，用 kind 区分（不要开两个 store，否则侧栏要写两遍同样的渲染）：
 *   local     —— 用户创建的，带 songs 数组，可增删改、可拖拽排序
 *   collected —— 收藏的**线上**歌单（网易云/咪咕），只存指针与展示字段，曲目仍按需远程拉
 *
 * 歌的增删**一律按 Norm.key（source:id）判定**：同一个歌单里不可能出现两首
 * "同一音源同一 id"的歌，但 netease:123 与 migu:123 是两首不同的歌，必须都能进去。
 *
 * 落盘走 config.extra（旧 13 键 schema 不动），统一走 config.update 的防抖通道。
 */
import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import { key as songKey } from '../data/normalize';
import type { Playlist, Song, SongSource } from '../data/normalize';
import { useConfigStore } from './config';

export const EXTRA_PLAYLISTS_KEY = 'playlists';
export const EXTRA_COLLECTED_KEY = 'collectedPlaylists';

export interface LocalPlaylist {
  kind: 'local';
  id: string;
  name: string;
  description: string;
  /** 用户上传的封面（data URL）或空串 */
  cover: string;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
}

/** 收藏的线上歌单：只有指针，不复制曲目 */
export interface CollectedPlaylist {
  kind: 'collected';
  id: string;
  name: string;
  cover: string;
  creator: string;
  count: number;
  source: SongSource;
  sourceId: string | number;
  collectedAt: number;
}

export type AnyPlaylist = LocalPlaylist | CollectedPlaylist;

/** 创建/编辑时允许改的字段 */
export interface PlaylistDraft {
  name: string;
  description?: string;
  cover?: string;
}

/** 确定性的 id 工厂（测试可注入，避免依赖 Date.now/random） */
export type IdFactory = () => string;

export const defaultIdFactory: IdFactory = () => 'pl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

/** 名字去空；空名给默认占位（UI 层也会拦，这里是最后一道） */
export function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '(未命名歌单)' : trimmed;
}

export function createPlaylist(
  list: readonly LocalPlaylist[],
  draft: PlaylistDraft,
  now: number = Date.now(),
  idFactory: IdFactory = defaultIdFactory,
): { list: LocalPlaylist[]; playlist: LocalPlaylist } {
  const playlist: LocalPlaylist = {
    kind: 'local',
    id: idFactory(),
    name: normalizeName(draft.name),
    description: draft.description ?? '',
    cover: draft.cover ?? '',
    songs: [],
    createdAt: now,
    updatedAt: now,
  };
  // 越晚创建越靠前？不 —— 保持创建顺序（用户在侧栏看到的顺序更符合预期）
  return { list: [...list, playlist], playlist };
}

/** 改名 / 改描述 / 改封面；未提供的字段保持原样 */
export function updatePlaylist(
  list: readonly LocalPlaylist[],
  id: string,
  patch: Partial<PlaylistDraft>,
  now: number = Date.now(),
): LocalPlaylist[] {
  return list.map((p) => {
    if (p.id !== id) return p;
    const next: LocalPlaylist = { ...p, updatedAt: now };
    if (patch.name !== undefined) next.name = normalizeName(patch.name);
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.cover !== undefined) next.cover = patch.cover;
    return next;
  });
}

export function deletePlaylist(list: readonly LocalPlaylist[], id: string): LocalPlaylist[] {
  return list.filter((p) => p.id !== id);
}

export function findPlaylist(list: readonly LocalPlaylist[], id: string): LocalPlaylist | null {
  return list.find((p) => p.id === id) ?? null;
}

export interface AddSongsResult {
  list: LocalPlaylist[];
  /** 真正加进去的条数（已存在的不算） */
  added: number;
  /** 因为重复被跳过的条数 */
  duplicates: number;
  /** 没有身份键（缺 id）被跳过的条数 */
  invalid: number;
}

/** 加歌：按 key 去重，追加到末尾（保持用户的添加顺序） */
export function addSongs(
  list: readonly LocalPlaylist[],
  id: string,
  songs: readonly Song[],
  now: number = Date.now(),
): AddSongsResult {
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  const next = list.map((p) => {
    if (p.id !== id) return p;
    const seen = new Set(p.songs.map((s) => songKey(s)));
    const incoming: Song[] = [];
    for (const song of songs) {
      const k = songKey(song);
      if (!k) {
        invalid += 1;
        continue;
      }
      if (seen.has(k)) {
        duplicates += 1;
        continue;
      }
      seen.add(k);
      incoming.push(song);
      added += 1;
    }
    if (incoming.length === 0) return p;
    return { ...p, songs: [...p.songs, ...incoming], updatedAt: now };
  });
  return { list: next, added, duplicates, invalid };
}

/** 按 key 移歌（比按下标稳：拖拽/并发删除时下标会漂） */
export function removeSongs(
  list: readonly LocalPlaylist[],
  id: string,
  keys: readonly string[],
  now: number = Date.now(),
): LocalPlaylist[] {
  const drop = new Set(keys);
  return list.map((p) => {
    if (p.id !== id) return p;
    const songs = p.songs.filter((s) => !drop.has(songKey(s)));
    if (songs.length === p.songs.length) return p;
    return { ...p, songs, updatedAt: now };
  });
}

export function removeSongAt(
  list: readonly LocalPlaylist[],
  id: string,
  index: number,
  now: number = Date.now(),
): LocalPlaylist[] {
  const target = findPlaylist(list, id);
  if (!target || index < 0 || index >= target.songs.length) return [...list];
  const k = songKey(target.songs[index]);
  return removeSongs(list, id, [k], now);
}

/**
 * 拖拽排序：把 from 位置的歌移到 to 位置。
 * to 用"移动后在数组里的目标下标"，与 HTML5 drag 的"插到第几个之前"换算一次即可。
 */
export function moveSong(
  list: readonly LocalPlaylist[],
  id: string,
  from: number,
  to: number,
  now: number = Date.now(),
): LocalPlaylist[] {
  return list.map((p) => {
    if (p.id !== id) return p;
    const n = p.songs.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return p;
    const songs = [...p.songs];
    const [moved] = songs.splice(from, 1);
    songs.splice(to, 0, moved);
    return { ...p, songs, updatedAt: now };
  });
}

/** 收藏一个线上歌单（同 source 同 id 视为同一个，不重复收藏） */
export function collectPlaylist(
  list: readonly CollectedPlaylist[],
  source: Playlist,
  now: number = Date.now(),
  idFactory: IdFactory = defaultIdFactory,
): { list: CollectedPlaylist[]; added: boolean } {
  const sourceId = source.id;
  const exists = list.some((p) => p.source === source.source && String(p.sourceId) === String(sourceId));
  if (exists || sourceId === undefined || sourceId === '') {
    return { list: [...list], added: false };
  }
  const item: CollectedPlaylist = {
    kind: 'collected',
    id: idFactory(),
    name: source.name,
    cover: source.cover,
    creator: source.creator,
    count: source.count,
    source: source.source,
    sourceId,
    collectedAt: now,
  };
  return { list: [item, ...list], added: true };
}

export function uncollectPlaylist(list: readonly CollectedPlaylist[], id: string): CollectedPlaylist[] {
  return list.filter((p) => p.id !== id);
}

/** 线上歌单条目 → normalize.Playlist（让 PlaylistView 能直接打开收藏的线上歌单） */
export function toRemotePlaylist(p: CollectedPlaylist): Playlist {
  return {
    source: p.source,
    id: p.sourceId,
    name: p.name,
    cover: p.cover,
    creator: p.creator,
    count: p.count,
    playCount: '',
  };
}

/** JSON 字符串或数组 → 数组（旧数据 / 手写配置仍走数组分支） */
function asArray(raw: unknown): unknown[] {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/** 从 config.extra 捡回歌单（外部可改坏，逐条校验） */
export function parseStoredPlaylists(raw: unknown): LocalPlaylist[] {
  const items = asArray(raw);
  const out: LocalPlaylist[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!id) continue;
    const songs = Array.isArray(rec.songs)
      ? rec.songs.filter((s): s is Song => typeof s === 'object' && s !== null && songKey(s as Song) !== '')
      : [];
    out.push({
      kind: 'local',
      id,
      name: typeof rec.name === 'string' && rec.name.trim() !== '' ? rec.name : '(未命名歌单)',
      description: typeof rec.description === 'string' ? rec.description : '',
      cover: typeof rec.cover === 'string' ? rec.cover : '',
      songs,
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : 0,
    });
  }
  return out;
}

export function parseStoredCollected(raw: unknown): CollectedPlaylist[] {
  const out: CollectedPlaylist[] = [];
  for (const item of asArray(raw)) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    const source = rec.source;
    if (!id || (source !== 'netease' && source !== 'migu')) continue;
    if (rec.sourceId === undefined || rec.sourceId === null) continue;
    out.push({
      kind: 'collected',
      id,
      name: typeof rec.name === 'string' ? rec.name : '(未命名歌单)',
      cover: typeof rec.cover === 'string' ? rec.cover : '',
      creator: typeof rec.creator === 'string' ? rec.creator : '',
      count: typeof rec.count === 'number' ? rec.count : 0,
      source,
      sourceId: rec.sourceId as string | number,
      collectedAt: typeof rec.collectedAt === 'number' ? rec.collectedAt : 0,
    });
  }
  return out;
}

/**
 * 歌单在 config.extra 里存成 **JSON 字符串**，不存对象数组。
 *
 * 原因（本次实测踩到）：config.saveQueue() 会展开 `config.value.extra`，
 * 而 config.value 是深度 ref，展开拿到的值都是 Vue 代理；
 * 代理进 IPC 时结构化克隆抛 "An object could not be cloned."，
 * player 的队列写盘就静默失败了（UI 全对，重开数据全丢）。
 * 把自定义数据收敛成字符串后，外层展开只剩原始值，不会再触发这个坑。
 */
function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export const usePlaylistsStore = defineStore('playlists', () => {
  const config = useConfigStore();
  /** shallowRef：见 favorites.ts 的说明 —— 歌单里的 Song 必须是普通对象 */
  const local = shallowRef<LocalPlaylist[]>([]);
  const collected = shallowRef<CollectedPlaylist[]>([]);

  const count = computed(() => local.value.length);
  const collectedCount = computed(() => collected.value.length);
  const totalSongs = computed(() => local.value.reduce((n, p) => n + p.songs.length, 0));

  /** 两个 extra 键一起写（同一个 patch 里合并不成问题：都是整体替换） */
  function persist(nextLocal: LocalPlaylist[], nextCollected: CollectedPlaylist[] = collected.value): void {
    local.value = nextLocal;
    collected.value = nextCollected;
    const extra = {
      ...(config.config?.extra ?? {}),
      [EXTRA_PLAYLISTS_KEY]: toJson(nextLocal),
      [EXTRA_COLLECTED_KEY]: toJson(nextCollected),
    };
    config.update({ extra });
  }

  function hydrate(): void {
    const storedLocal = parseStoredPlaylists(config.config?.extra?.[EXTRA_PLAYLISTS_KEY]);
    const storedCollected = parseStoredCollected(config.config?.extra?.[EXTRA_COLLECTED_KEY]);
    if (storedLocal.length > 0 && local.value.length === 0) local.value = storedLocal;
    if (storedCollected.length > 0 && collected.value.length === 0) collected.value = storedCollected;
  }

  function byId(id: string): LocalPlaylist | null {
    return findPlaylist(local.value, id);
  }

  function create(draft: PlaylistDraft): LocalPlaylist {
    const result = createPlaylist(local.value, draft);
    persist(result.list);
    return result.playlist;
  }

  function update(id: string, patch: Partial<PlaylistDraft>): void {
    persist(updatePlaylist(local.value, id, patch));
  }

  function remove(id: string): void {
    persist(deletePlaylist(local.value, id));
  }

  function addSongsTo(id: string, songs: readonly Song[]): AddSongsResult['added'] {
    const result = addSongs(local.value, id, songs);
    if (result.list !== local.value) persist(result.list);
    return result.added;
  }

  function removeSongsFrom(id: string, keys: readonly string[]): void {
    persist(removeSongs(local.value, id, keys));
  }

  function removeAt(id: string, index: number): void {
    persist(removeSongAt(local.value, id, index));
  }

  function move(id: string, from: number, to: number): void {
    persist(moveSong(local.value, id, from, to));
  }

  function collect(source: Playlist): boolean {
    const result = collectPlaylist(collected.value, source);
    if (!result.added) return false;
    persist(local.value, result.list);
    return true;
  }

  function uncollect(id: string): void {
    persist(local.value, uncollectPlaylist(collected.value, id));
  }

  function isCollected(source: Playlist): boolean {
    return collected.value.some(
      (p) => p.source === source.source && String(p.sourceId) === String(source.id),
    );
  }

  /** 导入结果落库：新建歌单 + 批量加歌（导出-导入闭环的最后一步） */
  function importAsPlaylist(draft: PlaylistDraft, songs: readonly Song[]): LocalPlaylist {
    const result = createPlaylist(local.value, draft);
    const withSongs = addSongs(result.list, result.playlist.id, songs);
    persist(withSongs.list);
    return findPlaylist(withSongs.list, result.playlist.id) ?? result.playlist;
  }

  return {
    local,
    collected,
    count,
    collectedCount,
    totalSongs,
    hydrate,
    byId,
    create,
    update,
    remove,
    addSongsTo,
    removeSongsFrom,
    removeAt,
    move,
    collect,
    uncollect,
    isCollected,
    importAsPlaylist,
  };
});
