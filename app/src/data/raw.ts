/**
 * 旧版接口的**原始响应**结构（只用于 repository 里的 picker 入参）。
 *
 * 这里刻意全部 optional + 宽松类型：网易云/咪咕的响应字段经常缺、
 * 偶尔变类型（duration 有时 number 有时 string），picker 必须能容忍。
 * 渲染层其余部分**不允许** import 本文件 —— 那是瘦身失效的信号。
 */
import type { SongSource } from './normalize';

// ---------------------------------------------------------------- 网易云

export interface NESongRaw {
  id?: number | string;
  name?: string;
  /** /cloudsearch /search 形态 */
  artists?: { name?: string }[];
  album?: { name?: string; picUrl?: string };
  duration?: number;
  /** /playlist/detail /song/detail /album 形态 */
  ar?: { name?: string }[];
  al?: { name?: string; picUrl?: string };
  dt?: number;
  fee?: number;
}

export interface NEArtistRaw {
  id?: number;
  name?: string;
  picUrl?: string;
  img1v1Url?: string;
  musicSize?: number;
  albumSize?: number;
  briefDesc?: string;
}

export interface NEAlbumRaw {
  id?: number;
  name?: string;
  picUrl?: string;
  publishTime?: number;
  size?: number;
  /** /artist/album 的 hotAlbums 项里 artist 是对象，/album 的 songs 里 al 才是封面源 */
  al?: { picUrl?: string };
}

export interface NEPlaylistRaw {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  picUrl?: string;
  trackCount?: number;
  playCount?: number;
  creator?: { nickname?: string };
}

export interface NECommentRaw {
  commentId?: number;
  content?: string;
  likedCount?: number;
  time?: number;
  timeStr?: string;
  user?: { nickname?: string; avatarUrl?: string };
  beReplied?: { content?: string; user?: { nickname?: string } }[];
}

export interface NESearchResultRaw {
  songs?: NESongRaw[];
  songCount?: number;
  playlists?: NEPlaylistRaw[];
  playlistCount?: number;
  artists?: NEArtistRaw[];
  artistCount?: number;
  albums?: NEAlbumRaw[];
  albumCount?: number;
}

// ---------------------------------------------------------------- 咪咕

export interface MiguSingerRaw {
  id?: string | number;
  name?: string;
  img?: string;
}

export interface MiguSongRaw {
  contentId?: string;
  songId?: string;
  id?: string;
  copyrightId?: string;
  resourceType?: string;
  songName?: string;
  name?: string;
  singerList?: MiguSingerRaw[];
  album?: string;
  img1?: string;
  img2?: string;
  img3?: string;
  /** **秒**，不是毫秒 */
  duration?: number;
  showTags?: string[];
}

/** 咪咕歌手歌曲块：x.txt/x.txt2/x.txt3/resId，没有歌手数组 */
export interface MiguSingerSongRaw {
  resId?: string;
  txt?: string;
  txt2?: string;
  txt3?: string;
  img?: string;
}

export interface MiguSingerDetailRaw {
  singerId?: string | number;
  id?: string | number;
  singer?: string;
  name?: string;
  imgs?: { imgSizeType?: string; img?: string }[];
  songNum?: number;
  albumNum?: number;
  summary?: string;
}

/** 搜索结果里的歌手包装：{ singer: {...} } */
export interface MiguSingerItemRaw {
  singer?: MiguSingerDetailRaw;
}

export interface MiguPlaylistRaw {
  musicListId?: string;
  id?: string;
  title?: string;
  name?: string;
  imgItem?: { img?: string };
  originalImgUrl?: string;
  ownerName?: string;
  musicNum?: number;
  opNumItem?: { playNumDesc?: string };
}

export interface MiguAlbumRaw {
  resId?: string;
  txt?: string;
  img?: string;
  txt3?: string;
}

/** 数字专辑搜索结果项（searchAlbum → items[].dalbum），字段名与 ZJ-Album-Item 完全不同 */
export interface MiguDAlbumRaw {
  contentId?: string;
  copyrightId?: string;
  title?: string;
  singer?: string;
  imgItems?: { imgSizeType?: string; img?: string }[];
  totalCount?: number;
  publishDate?: string;
  opNumItem?: { playNumDesc?: string };
  price?: number;
}

export interface MiguSearchRaw<T> {
  code?: string;
  info?: string;
  data?: { items?: T[]; hasNext?: boolean; totalCount?: number };
}

export interface MiguUrlRaw {
  code?: string;
  info?: string;
  data?: {
    url?: string;
    lrcUrl?: string;
    auditionsLength?: number;
    auditionsStartTime?: number;
    audioFormatType?: string;
  };
}

/** 跨源通用的"可能是任一源"的原始歌曲（resolve 时用） */
export interface AnySongRaw {
  source?: SongSource;
}
