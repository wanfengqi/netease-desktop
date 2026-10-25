/**
 * 音源归一化层（S1 建立"跨源身份"，S2 补齐旧版 normalize.js 的其余归一化函数）。
 *
 * 旧版 src/renderer/normalize.js:29 的真实定义：
 *   const key = (s) => s ? (s.source || 'netease') + ':' + (s.id != null ? s.id : s.contentId) : '';
 * 即 key 是 「source:id」，跨源唯一 —— 收藏去重 / 播放高亮 / 队列拖拽全靠它，
 * 因为网易云与咪咕的 id 空间会撞车，只用 id 去重是错的。
 *
 * 项目铁律：音源差异只允许出现在**这一层**与 repository 层的 picker。
 * UI 层只认下面这套统一结构，禁止直接读某个音源的原始字段。
 */
import type {
  MiguAlbumRaw,
  MiguPlaylistRaw,
  MiguSingerDetailRaw,
  MiguSingerSongRaw,
  MiguSongRaw,
  NEAlbumRaw,
  NEArtistRaw,
  NEPlaylistRaw,
  NESongRaw,
  MiguSingerItemRaw,
} from './raw';

/** 目前接入的两个音源。新增音源时先改这里，让所有 switch 编译期报错。 */
export type SongSource = 'netease' | 'migu' | 'local';

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
 * 统一歌曲对象。UI 层只认这一套字段，禁止直接读某个音源的原始字段。
 * 咪咕额外保留播放所需字段：contentId / copyrightId / resourceType。
 */
export interface Song {
  id: string | number;
  source: SongSource;
  name: string;
  /** 展示用的人名串，已按 "A / B" 拼好，UI 不要自己 join */
  artistText: string;
  artists: readonly SongArtist[];
  album: SongAlbum;
  /** 毫秒 */
  duration: number;
  vip?: boolean;
  /** 咪咕播放必需；其余源为空 */
  contentId?: string;
  copyrightId?: string;
  resourceType?: string;
  /** 本地扫描或已完成下载的绝对路径；仅用于本机离线播放 */
  localPath?: string;
}

/** 统一歌单对象 */
export interface Playlist {
  source: SongSource;
  id: string | number | undefined;
  name: string;
  cover: string;
  creator: string;
  count: number;
  /** 已格式化的可读文本（1.2万 / 3.4亿）；咪咕直接给文本 */
  playCount: string;
}

/** 统一歌手对象 */
export interface Artist {
  source: SongSource;
  id: string | number | undefined;
  name: string;
  avatar: string;
  songNum: number;
  albumNum: number;
  brief: string;
}

/** 统一专辑对象 */
export interface Album {
  source: SongSource;
  id: string | number | undefined;
  name: string;
  cover: string;
  /** YYYY-MM-DD，未知为空串 */
  date: string;
  size: number;
}

/** 评论（网易云 /comment/music） */
export interface Comment {
  commentId: number | undefined;
  content: string;
  likedCount: number;
  time: number;
  timeStr: string;
  user: { nickname: string; avatarUrl: string } | null;
  beReplied: { content: string; nickname: string }[];
}

/** 咪咕图片 CDN 前缀；SDK 常返回相对路径 `/data/oss/...` */
export const MIGU_IMG_BASE = 'https://d.musicapp.migu.cn';

/** 咪咕图片路径 → 完整 URL（已是 http(s) 的原样返回） */
export function miguImg(src: string | undefined | null): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  return MIGU_IMG_BASE + src;
}

/** 播放量等大数字 → 1.2万 / 3.4亿（旧版 fmtCount 语义：字符串原样返回） */
export function fmtCount(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '';
  if (typeof n === 'string') return n;
  if (!Number.isFinite(n)) return '';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
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

// ================================================================ 歌曲

/**
 * 网易云歌曲 → 统一结构。
 * 兼容三种返回形态：
 *   /cloudsearch /search → artists[] / album{} / duration
 *   /playlist/detail     → ar[] / al{} / dt
 *   /song/detail /album  → ar[] / al{} / dt / fee
 */
export function neteaseSong(t: NESongRaw | null | undefined, extra: Partial<Song> = {}): Song | null {
  if (!t) return null;
  const ar = t.ar ?? t.artists ?? [];
  const al = t.al ?? t.album ?? {};
  return {
    source: 'netease',
    id: t.id ?? '',
    name: t.name ?? '',
    artists: ar.map((a) => ({ name: a?.name ?? '' })),
    artistText: ar.map((a) => a?.name).filter((n): n is string => Boolean(n)).join(' / '),
    album: { name: al.name ?? '', picUrl: al.picUrl ?? '' },
    duration: t.dt ?? t.duration ?? 0,
    vip: t.fee === 1,
    ...extra,
  };
}

/** 咪咕歌曲（搜索结果 / 歌单曲目 / 专辑曲目）→ 统一结构 */
export function miguSong(s: MiguSongRaw | null | undefined, extra: Partial<Song> = {}): Song | null {
  if (!s) return null;
  const singers = s.singerList ?? [];
  const id = s.contentId ?? s.songId ?? s.id ?? '';
  return {
    source: 'migu',
    id,
    contentId: s.contentId ?? s.songId ?? s.id,
    copyrightId: s.copyrightId,
    resourceType: s.resourceType ?? '2',
    name: s.songName ?? s.name ?? '',
    artists: singers.map((x) => ({ name: x?.name ?? '' })),
    artistText: singers.map((x) => x?.name).filter((n): n is string => Boolean(n)).join(' / '),
    album: {
      name: s.album ?? extra.album?.name ?? '',
      picUrl: miguImg(s.img1 ?? s.img2 ?? s.img3 ?? extra.album?.picUrl ?? ''),
    },
    // 咪咕给**秒**，统一成毫秒（旧版同样 *1000）
    duration: (s.duration ?? 0) * 1000,
    vip: (s.showTags ?? []).includes('vip'),
    ...extra,
  };
}

/** 咪咕歌手热门歌曲块（结构是 x.txt/x.txt2/x.txt3/resId，没有歌手数组） */
export function miguSingerSong(x: MiguSingerSongRaw, artistName = ''): Song {
  return {
    source: 'migu',
    id: x.resId ?? '',
    contentId: x.resId,
    name: x.txt ?? '',
    artists: [{ name: x.txt2 ?? artistName }],
    artistText: x.txt2 ?? artistName,
    album: { name: x.txt3 ?? '', picUrl: miguImg(x.img ?? '') },
    duration: 0,
    vip: false,
  };
}

// ================================================================ 歌单

/** 网易云歌单 → 统一结构 */
export function neteasePlaylist(p: NEPlaylistRaw): Playlist {
  return {
    source: 'netease',
    id: p.id,
    name: p.name ?? '(未命名歌单)',
    cover: p.coverImgUrl ?? p.picUrl ?? '',
    creator: p.creator?.nickname ?? '',
    count: p.trackCount ?? 0,
    playCount: fmtCount(p.playCount),
  };
}

/** 咪咕歌单（data.items[].musicList）→ 统一结构 */
export function miguPlaylistItem(it: { musicList?: MiguPlaylistRaw } | MiguPlaylistRaw): Playlist {
  const ml: MiguPlaylistRaw = 'musicList' in it && it.musicList ? it.musicList : (it as MiguPlaylistRaw);
  return {
    source: 'migu',
    id: ml.musicListId ?? ml.id,
    name: ml.title ?? ml.name ?? '(未命名歌单)',
    cover: miguImg(ml.imgItem?.img ?? ml.originalImgUrl ?? ''),
    creator: ml.ownerName ?? '',
    count: ml.musicNum ?? 0,
    playCount: ml.opNumItem?.playNumDesc ?? '',
  };
}

// ================================================================ 歌手

/** 网易云歌手 → 统一结构 */
export function neteaseArtist(a: NEArtistRaw): Artist {
  return {
    source: 'netease',
    id: a.id,
    name: a.name ?? '',
    avatar: a.picUrl ?? a.img1v1Url ?? '',
    songNum: a.musicSize ?? 0,
    albumNum: a.albumSize ?? 0,
    brief: String(a.briefDesc ?? '').replace(/\s+/g, ' ').trim(),
  };
}

/** 咪咕歌手（data.items[].singer）→ 统一结构。优先取 02 号尺寸的图。 */
export function miguArtist(it: MiguSingerItemRaw | MiguSingerDetailRaw): Artist {
  // 两种入参：搜索结果的 { singer: {...} } 包装，或已解包的歌手对象本身。
  // 注意歌手对象自己的 `singer` 字段是**名字字符串**，所以必须判 object。
  const wrapped = (it as MiguSingerItemRaw).singer;
  const s: MiguSingerDetailRaw =
    wrapped && typeof wrapped === 'object' ? wrapped : (it as MiguSingerDetailRaw);
  const imgs = s.imgs ?? [];
  const pick = imgs.find((x) => x.imgSizeType === '02') ?? imgs[0] ?? {};
  return {
    source: 'migu',
    id: s.singerId ?? s.id,
    name: s.singer ?? s.name ?? '',
    avatar: miguImg(pick.img ?? ''),
    songNum: s.songNum ?? 0,
    albumNum: s.albumNum ?? 0,
    brief: String(s.summary ?? '').replace(/\s+/g, ' ').trim(),
  };
}

// ================================================================ 专辑

/** 网易云专辑（/artist/album → hotAlbums）→ 统一结构 */
export function neteaseAlbum(a: NEAlbumRaw): Album {
  return {
    source: 'netease',
    id: a.id,
    name: a.name ?? '(未命名专辑)',
    cover: a.picUrl ?? a.al?.picUrl ?? '',
    date: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : '',
    size: a.size ?? 0,
  };
}

/** 咪咕专辑（data.contents[]，view=ZJ-Album-Item）→ 统一结构 */
export function miguAlbum(x: MiguAlbumRaw): Album {
  return {
    source: 'migu',
    id: x.resId,
    name: x.txt ?? '(未命名专辑)',
    cover: miguImg(x.img ?? ''),
    date: x.txt3 ?? '',
    size: 0,
  };
}
