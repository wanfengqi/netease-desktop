/**
 * 音源归一化层（S1 只放"跨源身份"这部分）。
 *
 * 旧版 src/renderer/normalize.js:29 的真实定义：
 *   const key = (s) => s ? (s.source || 'netease') + ':' + (s.id != null ? s.id : s.contentId) : '';
 * 即 key 是 「source:id」，跨源唯一 —— 收藏去重 / 播放高亮 / 队列拖拽全靠它，
 * 因为网易云与咪咕的 id 空间会撞车，只用 id 去重是错的。
 */

/** 目前接入的两个音源。新增音源时先改这里，让所有 switch 编译期报错。 */
export type SongSource = 'netease' | 'migu';

/** 跨源唯一身份键，形如 `netease:12345` / `migu:6009070000001`。 */
export type SongKey = string;

export interface SongArtist {
  name: string;
}

export interface SongAlbum {
  name: string;
  picUrl?: string;
}

/**
 * 统一歌曲对象。UI 层只认这一套字段，禁止直接读某个音源的原始字段
 * （旧版铁律：音源差异只允许出现在归一化层与 transport 层）。
 */
export interface Song {
  id: string | number;
  source: SongSource;
  name: string;
  /** 展示用的人名串，已按 "A / B" 拼好，UI 不要自己 join */
  artistText: string;
  artists: SongArtist[];
  album: SongAlbum;
  /** 毫秒 */
  duration: number;
  vip?: boolean;
}

/**
 * 歌曲身份键。空对象/缺 id 返回空串（旧版对 `!s` 返回 ''，
 * 这里把"缺 id"也归到同一档，避免产生 "netease:undefined" 这种假键）。
 */
export function key(song: Song | null | undefined): SongKey {
  if (!song) return '';
  const { id } = song;
  if (id === null || id === undefined || id === '') return '';
  return `${song.source}:${String(id)}`;
}

/** 两首歌是否同一首（跨源安全）。 */
export function sameSong(a: Song | null | undefined, b: Song | null | undefined): boolean {
  const ka = key(a);
  return ka !== '' && ka === key(b);
}
