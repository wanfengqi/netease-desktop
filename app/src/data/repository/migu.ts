/**
 * 咪咕 repository（S2）。
 *
 * migu-api-enhanced 的响应有两层壳：{ code:'000000', data:{...} }。
 * 这一层负责拆壳 + picker 瘦身，渲染层永远看不到 `track` 那种实验埋点串。
 *
 * 取址走 getUrlH5V24（V1/V2 多数情况不返回 url，这是唯一稳定的接口）。
 */
import {
  fmtCount,
  miguAlbum,
  miguArtist,
  miguImg,
  miguPlaylistItem,
  miguSingerSong,
  miguSong,
  type Album,
  type Artist,
  type Playlist,
  type Song,
} from '../normalize';
import type {
  MiguAlbumRaw,
  MiguDAlbumRaw,
  MiguPlaylistRaw,
  MiguSingerItemRaw,
  MiguSingerSongRaw,
  MiguSongRaw,
  MiguUrlRaw,
} from '../raw';
import {
  assertMiguOk,
  TransportError,
  unwrapMigu,
  withRetry,
  withTimeout,
  DEFAULT_RETRY,
  type MiguCallResult,
} from '../transport';
import type {
  HotWord,
  LyricData,
  MiguRankGroup,
  Paged,
  PageQuery,
  PlayUrl,
  RecommendPlaylist,
} from './types';

/** 渲染层可见的 window.api.migu 子集（注入便于测试） */
export interface MiguBridge {
  searchSong: (keywords: string, page?: number) => Promise<MiguCallResult>;
  searchSinger: (keywords: string, page?: number) => Promise<MiguCallResult>;
  searchAlbum: (keywords: string, page?: number) => Promise<MiguCallResult>;
  searchPlaylist: (keywords: string, page?: number) => Promise<MiguCallResult>;
  getUrlH5V24: (contentId: string, copyrightId: string, toneFlag?: string) => Promise<MiguCallResult>;
  getLyric: (contentId: string, type?: string) => Promise<MiguCallResult>;
  getSingerSong: (singerId: string, page?: number) => Promise<MiguCallResult>;
  getSingerAlbum: (singerId: string, page?: number) => Promise<MiguCallResult>;
  getAlbumSong: (albumId: string, page?: number) => Promise<MiguCallResult>;
  getPlaylistSong: (playlistId: string, page?: number, size?: number) => Promise<MiguCallResult>;
  getSongInfo: (contentIds: string) => Promise<MiguCallResult>;
  getAlbumInfo: (albumId: string) => Promise<MiguCallResult>;
  getTodayRecommend: (pacmToken: string) => Promise<MiguCallResult>;
  getRankIndex: () => Promise<MiguCallResult>;
  getRecommendPlaylist: () => Promise<MiguCallResult>;
  getNewSongList: () => Promise<MiguCallResult>;
  getSimilarSongRecommend: (contentId?: string) => Promise<MiguCallResult>;
  getSearchHot: () => Promise<MiguCallResult>;
  fetchText: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
}

export interface MiguRepoOptions {
  bridge?: MiguBridge;
  timeoutMs?: number;
  retries?: number;
  delay?: (ms: number) => Promise<void>;
}

function defaultBridge(): MiguBridge {
  const api = (globalThis as unknown as { window?: { api?: { migu?: MiguBridge } } }).window?.api;
  const mg = api?.migu;
  if (!mg || typeof mg.searchSong !== 'function') {
    throw new TransportError({
      message: 'window.api.migu 不可用（preload 未连接或不在 Electron 环境）',
      retryable: false,
    });
  }
  return mg;
}

/** 咪咕咪咕：统一拆壳 —— 校验 '000000' 后返回 data */
function pickData(body: unknown, label: string): Record<string, unknown> {
  assertMiguOk(body, label);
  const data = (body as { data?: unknown }).data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export class MiguRepository {
  private readonly options: MiguRepoOptions;

  constructor(options: MiguRepoOptions = {}) {
    this.options = options;
  }

  private bridge(): MiguBridge {
    return this.options.bridge ?? defaultBridge();
  }

  /** 统一调用入口：超时 + 重试（咪咕 SDK 偶发 ECONNRESET，值得重试） */
  private async call(method: keyof MiguBridge, args: unknown[]): Promise<unknown> {
    const timeoutMs = this.options.timeoutMs ?? 15000;
    const retries = this.options.retries ?? DEFAULT_RETRY.retries;
    return withRetry(
      async () => {
        const bridge = this.bridge();
        const fn = bridge[method] as (...a: unknown[]) => Promise<MiguCallResult>;
        const result = await withTimeout(fn.apply(bridge, args), timeoutMs, 'migu ' + String(method));
        return unwrapMigu(result, 'migu ' + String(method));
      },
      { retries, delay: this.options.delay },
    );
  }

  // ------------------------------------------------------------ 搜索

  /** 搜索单曲 */
  async searchSongs(keywords: string, options: PageQuery = {}): Promise<Paged<Song>> {
    const limit = options.limit ?? 20;
    const body = await this.call('searchSong', [keywords, options.page ?? 1]);
    const data = pickData(body, 'migu searchSong');
    const items = ((data.items ?? []) as { song?: MiguSongRaw }[])
      .map((it) => miguSong(it.song ?? (it as unknown as MiguSongRaw)))
      .filter((s): s is Song => s !== null)
      .slice(0, limit);
    return { items, hasMore: Boolean(data.hasNext), total: typeof data.totalCount === 'number' ? data.totalCount : undefined };
  }

  /** 搜索歌手 */
  async searchArtists(keywords: string, options: PageQuery = {}): Promise<Paged<Artist>> {
    const body = await this.call('searchSinger', [keywords, options.page ?? 1]);
    const data = pickData(body, 'migu searchSinger');
    const items = ((data.items ?? []) as MiguSingerItemRaw[]).map(miguArtist);
    return { items, hasMore: Boolean(data.hasNext) };
  }

  /** 搜索专辑 */
  async searchAlbums(keywords: string, options: PageQuery = {}): Promise<Paged<Album>> {
    const body = await this.call('searchAlbum', [keywords, options.page ?? 1]);
    const data = pickData(body, 'migu searchAlbum');
    const items = ((data.items ?? []) as { dalbum?: MiguDAlbumRaw }[])
      .map((it) => it.dalbum)
      .filter((d): d is MiguDAlbumRaw => Boolean(d))
      .map((d) => ({
        ...miguAlbum({ resId: d.contentId, txt: d.title, img: pickFirstImg(d), txt3: d.publishDate }),
        size: d.totalCount ?? 0,
      }));
    return { items, hasMore: Boolean(data.hasNext) };
  }

  /** 搜索歌单 */
  async searchPlaylists(keywords: string, options: PageQuery = {}): Promise<Paged<Playlist>> {
    const body = await this.call('searchPlaylist', [keywords, options.page ?? 1]);
    const data = pickData(body, 'migu searchPlaylist');
    const items = ((data.items ?? []) as { musicList?: MiguPlaylistRaw }[])
      .filter((it) => Boolean(it.musicList))
      .map((it) => miguPlaylistItem(it as { musicList: MiguPlaylistRaw }));
    return { items, hasMore: Boolean(data.hasNext) };
  }

  // ------------------------------------------------------------ 详情

  /** 歌手热门歌曲（data.contents[].contents[]，块可能为空） */
  async singerSongs(singerId: string, options: PageQuery = {}): Promise<Song[]> {
    const body = await this.call('getSingerSong', [singerId, options.page ?? 1]);
    const data = pickData(body, 'migu getSingerSong');
    const blocks = (data.contents ?? []) as { view?: string; contents?: MiguSingerSongRaw[] }[];
    const songBlock = blocks.find((b) => b.view === 'ZJ-Singer-Song-Scroll') ?? blocks.find((b) => (b.contents ?? []).length > 0);
    return (songBlock?.contents ?? []).map((x) => miguSingerSong(x));
  }

  /** 歌手专辑（data.contents[]，view=ZJ-Album-Item） */
  async singerAlbums(singerId: string, options: PageQuery = {}): Promise<Paged<Album>> {
    const body = await this.call('getSingerAlbum', [singerId, options.page ?? 1]);
    const data = pickData(body, 'migu getSingerAlbum');
    const items = ((data.contents ?? []) as MiguAlbumRaw[]).filter((x) => Boolean(x.resId)).map(miguAlbum);
    const header = (data.header ?? {}) as { hasNext?: boolean };
    return { items, hasMore: Boolean(header.hasNext) };
  }

  /** 专辑曲目（data.songList） */
  async albumSongs(albumId: string, options: PageQuery = {}): Promise<Paged<Song>> {
    const body = await this.call('getAlbumSong', [albumId, options.page ?? 1]);
    const data = pickData(body, 'migu getAlbumSong');
    const items = ((data.songList ?? []) as MiguSongRaw[])
      .map((s) => miguSong(s))
      .filter((s): s is Song => s !== null);
    return { items, hasMore: Boolean(data.hasNext) };
  }

  /** 歌单曲目（data.songList） */
  async playlistSongs(playlistId: string, options: PageQuery = {}): Promise<Paged<Song>> {
    const size = options.limit ?? 100;
    const body = await this.call('getPlaylistSong', [playlistId, options.page ?? 1, size]);
    const data = pickData(body, 'migu getPlaylistSong');
    const items = ((data.songList ?? []) as MiguSongRaw[])
      .map((s) => miguSong(s))
      .filter((s): s is Song => s !== null);
    return {
      items,
      hasMore: typeof data.totalCount === 'number' ? items.length < data.totalCount : false,
      total: typeof data.totalCount === 'number' ? data.totalCount : undefined,
    };
  }

  // ------------------------------------------------------------ 歌词 / 取址

  /** 歌词：先取 getLyric；只给 lrcUrl 时再拉文本 */
  async lyric(contentId: string, type = 'lrc'): Promise<LyricData> {
    const body = (await this.call('getLyric', [contentId, type])) as {
      success?: boolean;
      lrc?: string;
      lrcUrl?: string;
      info?: string;
    };
    if (typeof body.lrc === 'string' && body.lrc !== '') {
      return { lyric: body.lrc, translation: '' };
    }
    if (typeof body.lrcUrl === 'string' && body.lrcUrl !== '') {
      const bridge = this.bridge();
      const text = await withTimeout(bridge.fetchText(body.lrcUrl), this.options.timeoutMs ?? 15000, 'migu lrc fetch');
      return { lyric: text.ok ? text.text ?? '' : '', translation: '' };
    }
    return { lyric: '', translation: '' };
  }

  /** 播放地址。需要 contentId + copyrightId；缺失时抛可识别错误。 */
  async songUrl(song: Song, toneFlag = 'PQ'): Promise<PlayUrl> {
    const contentId = song.contentId ?? String(song.id);
    if (!contentId) throw new TransportError({ message: 'migu 取址: 缺少 contentId', retryable: false });
    if (!song.copyrightId) throw new TransportError({ message: 'migu 取址: 缺少 copyrightId', retryable: false });

    const body = (await this.call('getUrlH5V24', [contentId, song.copyrightId, toneFlag])) as MiguUrlRaw;
    assertMiguOk(body, 'migu getUrlH5V24');
    const url = body.data?.url ?? null;
    return {
      url,
      br: 0,
      // 服务端标"60s 试听"，实测多数返回完整音频；如实透出以便 UI 提示
      auditionMs: body.data?.auditionsLength ?? 0,
      level: body.data?.audioFormatType ?? toneFlag,
      reason: url ? undefined : '咪咕无可用播放地址（可能需要会员）',
    };
  }

  // ------------------------------------------------------------ 本期新增

  /** 榜单索引：data.contents[] 每个分组下面挂 ZJ-Song-Scroll 项 */
  async rankIndex(): Promise<MiguRankGroup[]> {
    const body = await this.call('getRankIndex', []);
    const data = pickData(body, 'migu getRankIndex');
    const groups = (data.contents ?? []) as {
      style?: string;
      contents?: { rankId?: string; rankName?: string; imageUrl?: string }[];
    }[];
    return groups.map((g) => ({
      style: g.style ?? '',
      ranks: (g.contents ?? []).map((r) => ({
        rankId: r.rankId ?? '',
        rankName: r.rankName ?? '',
        imageUrl: miguImg(r.imageUrl ?? ''),
      })),
    }));
  }

  /** 推荐歌单（data.playLists[]，结构与搜索结果不同：用 resId/txt/img） */
  async recommendPlaylists(): Promise<RecommendPlaylist[]> {
    const body = await this.call('getRecommendPlaylist', []);
    const data = pickData(body, 'migu getRecommendPlaylist');
    const lists = (data.playLists ?? []) as {
      resId?: string;
      txt?: string;
      img?: string;
      resType?: string;
    }[];
    return lists.map((p) => ({
      source: 'migu' as const,
      id: p.resId,
      name: p.txt ?? '(未命名歌单)',
      cover: miguImg(p.img ?? ''),
      creator: '',
      count: 0,
      playCount: '',
      copywriter: '',
    }));
  }

  /**
   * 新歌榜（getNewSongList）。
   * 实测返回的是**导航壳**（contentItemList[0].itemList 全是 tab 的 actionUrl），
   * 不含歌曲实体 —— 因此这里只透出 tab 名称 + 对应拉取地址，不做假数据填充。
   */
  async newSongTabs(): Promise<{ title: string; url: string }[]> {
    const body = await this.call('getNewSongList', []);
    const data = pickData(body, 'migu getNewSongList');
    const blocks = (data.contentItemList ?? []) as {
      itemList?: { title?: string; actionUrl?: string }[];
    }[];
    const tabs: { title: string; url: string }[] = [];
    for (const block of blocks) {
      for (const it of block.itemList ?? []) {
        tabs.push({ title: it.title ?? '', url: it.actionUrl ?? '' });
      }
    }
    return tabs;
  }

  /** 相似歌曲推荐。实测多数 contentId 返回 contents:[]（服务端限流/无数据），如实返回空数组。 */
  async similarSongs(contentId?: string): Promise<Song[]> {
    const body = await this.call('getSimilarSongRecommend', contentId ? [contentId] : []);
    const data = pickData(body, 'migu getSimilarSongRecommend');
    const contents = (data.contents ?? []) as (MiguSongRaw & { songItem?: MiguSongRaw })[];
    return contents
      .map((x) => miguSong(x.songItem ?? x))
      .filter((s): s is Song => s !== null);
  }

  /** 搜索热词（data 是数组，不是对象） */
  async searchHot(): Promise<HotWord[]> {
    const body = (await this.call('getSearchHot', [])) as { code?: string; data?: unknown };
    assertMiguOk(body, 'migu getSearchHot');
    const tabs = Array.isArray(body.data) ? (body.data as { searchRankList?: { word?: string; rank?: number }[] }[]) : [];
    const words: HotWord[] = [];
    for (const tab of tabs) {
      for (const item of tab.searchRankList ?? []) {
        if (item.word) words.push({ word: item.word, rank: item.rank ?? words.length + 1 });
      }
    }
    return words;
  }

  /**
   * 今日推荐（需要 pacmToken）。
   * 注意这个接口的壳与其它不同：形如 { data: { code, info, ... }, newPacmToken }
   * —— 业务码嵌在 body.data 里，不是 body.code，所以不能直接用 assertMiguOk。
   */
  async todayRecommend(pacmToken = ''): Promise<{ newPacmToken: string; data: Record<string, unknown> }> {
    const body = (await this.call('getTodayRecommend', [pacmToken])) as {
      data?: { code?: string; info?: string };
      newPacmToken?: string;
    };
    const inner = body.data ?? {};
    if (typeof inner.code === 'string' && inner.code !== '000000' && inner.code !== '200') {
      throw new TransportError({
        message: 'migu getTodayRecommend: 咪咕返回 ' + inner.code + (inner.info ? ' ' + inner.info : ''),
        retryable: false,
      });
    }
    return { newPacmToken: body.newPacmToken ?? '', data: inner as Record<string, unknown> };
  }

  /**
   * 每日推荐曲目（S5）。
   *
   * 现状如实记录：getTodayRecommend 需要 pacmToken 手机号/IMEI 登录态，
   * 实测恒返回 { data: { code: '200205', info: '手机号和IMEI不能同时为空' } }，
   * 上面的 todayRecommend 会抛**不可重试**错误 —— 调用方必须据此降级，
   * 不能让它变成页面崩溃（这是已知接口限制，不是 bug）。
   *
   * 成功时的字段名尚未实测（手上没有有效 token），所以按"常见字段名"宽容抽取，
   * 抽不到就返回空数组，不编造数据。
   */
  async todayRecommendSongs(pacmToken = ''): Promise<Song[]> {
    const { data } = await this.todayRecommend(pacmToken);
    const list = (data['songList'] ?? data['contents'] ?? []) as MiguSongRaw[];
    return list.map((s) => miguSong(s)).filter((s): s is Song => s !== null);
  }
}

/** 取咪咕专辑封面：imgItems 里优先 02 号尺寸 */
function pickFirstImg(d: { imgItems?: { imgSizeType?: string; img?: string }[] }): string {
  const items = d.imgItems ?? [];
  const pick = items.find((x) => x.imgSizeType === '02') ?? items[0];
  return pick?.img ?? '';
}

export { fmtCount };
