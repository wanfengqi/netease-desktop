/**
 * repository 层的请求 / 响应类型（S2）。
 *
 * 这里的类型是**渲染层可见的最终形状** —— picker 从这里之后就不再变。
 * 原始响应类型在 ../raw.ts，只有 repository 内部能用。
 */
import type { Album, Artist, Comment, Playlist, Song } from '../normalize';

/** 分页参数（两个源共用的最小子集） */
export interface PageQuery {
  page?: number;
  limit?: number;
}

/** 列表 + 是否还有下一页 */
export interface Paged<T> {
  items: T[];
  /** 是否还有下一页；部分源不返回时按 items.length >= limit 推断 */
  hasMore: boolean;
  /** 总条数；未知为 undefined */
  total?: number;
}

export interface SearchOptions extends PageQuery {
  /** 网易云 cloudsearch 的 type：1 歌曲 10 专辑 100 歌手 1000 歌单 */
  type?: 1 | 10 | 100 | 1000;
}

/** 单曲播放地址解析结果 */
export interface PlayUrl {
  url: string | null;
  /** 码率（bps）；咪咕返回 0 */
  br: number;
  /** 试听片段长度（毫秒）；0 表示完整音频 */
  auditionMs: number;
  /** 音质标签，如 standard / PQ */
  level: string;
  /** 网易云在无版权/VIP 限制时返回 code=404 且 url=null，这里带上原因 */
  reason?: string;
}

/** 歌词 */
export interface LyricData {
  /** 原文 LRC */
  lyric: string;
  /** 翻译 LRC，可能为空 */
  translation: string;
}

/** 需要登录的接口在未登录时抛出可识别的错误 */
export interface LoginState {
  loggedIn: boolean;
  /** 昵称 / 用户 id，未登录为空 */
  nickname: string;
  userId: number | null;
}

export interface QrKey {
  /** 二维码内容（渲染层自己画成图） */
  qrContent: string;
  key: string;
}

/** 网易云推荐歌单（/personalized） */
export interface RecommendPlaylist extends Playlist {
  /** 推荐文案，如 "根据你喜欢的歌曲推荐" */
  copywriter: string;
}

/** 网易云榜单（/toplist → list[]） */
export interface ToplistItem {
  id: number;
  name: string;
  cover: string;
  trackCount: number;
  playCount: string;
  updateFrequency: string;
}

/** 咪咕榜单索引：分组 -> 榜单 */
export interface MiguRankGroup {
  style: string;
  ranks: { rankId: string; rankName: string; imageUrl: string }[];
}

/** 搜索热词 */
export interface HotWord {
  word: string;
  /** 排序权重；咪咕给 rank，网易云给 score */
  rank: number;
  /** 热度分（仅网易云 /search/hot/detail 提供，其余为 0 或省略） */
  score?: number;
}

export type { Song, Playlist, Artist, Album, Comment };
