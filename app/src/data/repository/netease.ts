/**
 * 网易云 repository（S2）。
 *
 * 每个方法：调主进程代理 → 校验业务码 → **自带 picker 瘦身** → 返回渲染层友好的形状。
 *
 * 与旧版的关键差别：瘦身不再在主进程按 path 分支做（旧版 slimPayload 三个 if），
 * 而是"谁调接口谁负责裁"—— 这样新增接口不需要动主进程，且裁剪逻辑离使用点最近。
 */
import {
  fmtCount,
  neteaseAlbum,
  neteaseArtist,
  neteasePlaylist,
  neteaseSong,
  type Album,
  type Artist,
  type Comment,
  type Playlist,
  type Song,
} from '../normalize';
import type {
  NEAlbumRaw,
  NEArtistRaw,
  NECommentRaw,
  NEPlaylistRaw,
  NESearchResultRaw,
  NESongRaw,
} from '../raw';
import {
  assertNeteaseCode,
  isRetryableStatus,
  TransportError,
  unwrapNetease,
  withRetry,
  withTimeout,
  DEFAULT_RETRY,
  type NeteaseRequestResult,
} from '../transport';
import type {
  HotWord,
  LyricData,
  LoginState,
  Paged,
  PageQuery,
  PlayUrl,
  QrKey,
  RecommendPlaylist,
  SearchOptions,
  ToplistItem,
} from './types';

/** 渲染层可见的 window.api.netease 子集（注入便于测试） */
export interface NeteaseBridge {
  request: (
    path: string,
    params?: Record<string, unknown>,
    cookie?: string,
  ) => Promise<NeteaseRequestResult>;
  status?: () => Promise<{ ready: boolean; port: number; pid: number }>;
}

export interface NeteaseRepoOptions {
  /** 渲染层本身不存 cookie，由调用方（store）传入 */
  getCookie?: () => string;
  bridge?: NeteaseBridge;
  timeoutMs?: number;
  retries?: number;
  /** 测试注入的延迟函数 */
  delay?: (ms: number) => Promise<void>;
}

/** 默认 bridge：读 window.api.netease（preload 暴露的白名单） */
function defaultBridge(): NeteaseBridge {
  const api = (globalThis as unknown as { window?: { api?: { netease?: NeteaseBridge } } }).window?.api;
  const ne = api?.netease;
  if (!ne || typeof ne.request !== 'function') {
    throw new TransportError({
      message: 'window.api.netease 不可用（preload 未连接或不在 Electron 环境）',
      retryable: false,
    });
  }
  return ne;
}

export class NeteaseRepository {
  private readonly options: NeteaseRepoOptions;

  constructor(options: NeteaseRepoOptions = {}) {
    this.options = options;
  }

  private bridge(): NeteaseBridge {
    return this.options.bridge ?? defaultBridge();
  }

  private cookie(): string {
    return this.options.getCookie?.() ?? '';
  }

  /** 统一的请求入口：超时 + 重试 + 业务码校验 */
  private async req(path: string, params: Record<string, unknown> = {}, allowedCodes: number[] = [200]): Promise<unknown> {
    const timeoutMs = this.options.timeoutMs ?? 15000;
    const retries = this.options.retries ?? DEFAULT_RETRY.retries;
    const body = await withRetry(
      async () => {
        const bridge = this.bridge();
        const result = await withTimeout(
          bridge.request(path, params, this.cookie()),
          timeoutMs,
          'netease ' + path,
        );
        return unwrapNetease(result, 'netease ' + path);
      },
      { retries, delay: this.options.delay },
    );
    assertNeteaseCode(body, 'netease ' + path, allowedCodes);
    return body;
  }

  /** 搜索（/cloudsearch）。type=1 歌曲 / 10 专辑 / 100 歌手 / 1000 歌单 */
  async search(keywords: string, options: SearchOptions = {}): Promise<Paged<Song | Album | Artist | Playlist>> {
    const type = options.type ?? 1;
    const limit = options.limit ?? 30;
    const body = (await this.req('/cloudsearch', {
      keywords,
      type,
      limit,
      offset: ((options.page ?? 1) - 1) * limit,
    })) as { result?: NESearchResultRaw };

    const result = body.result ?? {};
    if (type === 1) {
      const songs = (result.songs ?? []).map((s) => neteaseSong(s)).filter((s): s is Song => s !== null);
      return { items: songs, hasMore: songs.length >= limit, total: result.songCount };
    }
    if (type === 1000) {
      const lists = (result.playlists ?? []).map(neteasePlaylist);
      return { items: lists, hasMore: lists.length >= limit, total: result.playlistCount };
    }
    if (type === 100) {
      const artists = (result.artists ?? []).map(neteaseArtist);
      return { items: artists, hasMore: artists.length >= limit, total: result.artistCount };
    }
    const albums = (result.albums ?? []).map(neteaseAlbum);
    return { items: albums, hasMore: albums.length >= limit, total: result.albumCount };
  }

  /** 搜索单曲（最常用，单独给一个窄返回类型） */
  async searchSongs(keywords: string, options: PageQuery = {}): Promise<Paged<Song>> {
    const paged = await this.search(keywords, { ...options, type: 1 });
    return { items: paged.items as Song[], hasMore: paged.hasMore, total: paged.total };
  }

  /** 歌单详情（/playlist/detail） */
  async playlistDetail(id: string | number): Promise<{ playlist: Playlist; tracks: Song[] }> {
    const body = (await this.req('/playlist/detail', { id })) as {
      playlist?: NEPlaylistRaw & { tracks?: NESongRaw[] };
    };
    const pl = body.playlist;
    if (!pl) throw new TransportError({ message: 'netease /playlist/detail: 响应缺少 playlist' });
    return {
      playlist: neteasePlaylist(pl),
      tracks: (pl.tracks ?? []).map((t) => neteaseSong(t)).filter((s): s is Song => s !== null),
    };
  }

  /** 专辑详情（/album） */
  async albumDetail(id: string | number): Promise<{ album: Album; songs: Song[] }> {
    const body = (await this.req('/album', { id })) as {
      album?: NEAlbumRaw;
      songs?: NESongRaw[];
    };
    const albumRaw = body.album;
    if (!albumRaw) throw new TransportError({ message: 'netease /album: 响应缺少 album' });
    return {
      album: neteaseAlbum(albumRaw),
      songs: (body.songs ?? []).map((s) => neteaseSong(s)).filter((s): s is Song => s !== null),
    };
  }

  /** 歌手详情 + 热门 50 首（/artists） */
  async artistDetail(id: string | number): Promise<{ artist: Artist; hotSongs: Song[] }> {
    const body = (await this.req('/artists', { id })) as {
      artist?: NEArtistRaw;
      hotSongs?: NESongRaw[];
    };
    if (!body.artist) throw new TransportError({ message: 'netease /artists: 响应缺少 artist' });
    return {
      artist: neteaseArtist(body.artist),
      hotSongs: (body.hotSongs ?? []).map((s) => neteaseSong(s)).filter((s): s is Song => s !== null),
    };
  }

  /** 歌手专辑（/artist/album，取 hotAlbums） */
  async artistAlbums(id: string | number, options: PageQuery = {}): Promise<Paged<Album>> {
    const limit = options.limit ?? 30;
    const body = (await this.req('/artist/album', {
      id,
      limit,
      offset: ((options.page ?? 1) - 1) * limit,
    })) as { hotAlbums?: NEAlbumRaw[]; more?: boolean };
    const albums = (body.hotAlbums ?? []).map(neteaseAlbum);
    return { items: albums, hasMore: Boolean(body.more) };
  }

  /** 歌词（/lyric） */
  async lyric(id: string | number): Promise<LyricData> {
    const body = (await this.req('/lyric', { id })) as {
      lrc?: { lyric?: string };
      tlyric?: { lyric?: string };
    };
    return {
      lyric: body.lrc?.lyric ?? '',
      translation: body.tlyric?.lyric ?? '',
    };
  }

  /**
   * 播放地址（/song/url/v1）。
   * 无版权/需付费时网易云返回 HTTP 200 + data[0].code=404 + url=null ——
   * 这不是传输失败，返回 url:null + reason，由调用方决定提示。
   */
  async songUrl(id: string | number, level = 'standard'): Promise<PlayUrl> {
    const body = (await this.req('/song/url/v1', { id, level })) as {
      data?: { url?: string | null; br?: number; code?: number; fee?: number; freeTrialInfo?: unknown }[];
    };
    const first = body.data?.[0];
    if (!first) return { url: null, br: 0, auditionMs: 0, level, reason: '响应无 data' };
    const url = first.url ?? null;
    const auditionMs = first.freeTrialInfo ? 30000 : 0;
    return {
      url,
      br: first.br ?? 0,
      auditionMs,
      level,
      reason: url ? undefined : 'code=' + (first.code ?? 0) + '（无版权或需要会员）',
    };
  }

  /** 评论（/comment/music）。total 是全站累计数，不可当"本歌评论数"用。 */
  async comments(id: string | number, options: PageQuery = {}): Promise<Paged<Comment> & { hot: Comment[] }> {
    const limit = options.limit ?? 20;
    const body = (await this.req('/comment/music', {
      id,
      limit,
      offset: ((options.page ?? 1) - 1) * limit,
    })) as { hotComments?: NECommentRaw[]; comments?: NECommentRaw[]; more?: boolean; total?: number };
    return {
      items: (body.comments ?? []).map(pickComment),
      hot: (body.hotComments ?? []).map(pickComment),
      hasMore: Boolean(body.more),
      total: body.total,
    };
  }

  // ------------------------------------------------------------ 登录

  /** 登录状态（/login/status）。未登录不抛错，返回 loggedIn:false。 */
  async loginState(): Promise<LoginState> {
    if (!this.cookie()) return { loggedIn: false, nickname: '', userId: null };
    const body = (await this.req('/login/status')) as {
      data?: { profile?: { nickname?: string; userId?: number } | null };
    };
    const profile = body.data?.profile;
    return {
      loggedIn: Boolean(profile),
      nickname: profile?.nickname ?? '',
      userId: profile?.userId ?? null,
    };
  }

  /** 退出服务端登录；本地 cookie 由 account store 统一清理。 */
  async logout(): Promise<void> {
    await this.req('/logout');
  }

  /** 二维码登录：取 key（/login/qr/key） */
  async qrKey(): Promise<string> {
    const body = (await this.req('/login/qr/key')) as { data?: { unikey?: string } };
    const key = body.data?.unikey;
    if (!key) throw new TransportError({ message: 'netease /login/qr/key: 缺少 unikey' });
    return key;
  }

  /** 二维码登录：生成二维码内容（/login/qr/create） */
  async qrCreate(key: string): Promise<QrKey> {
    const body = (await this.req('/login/qr/create', { key, qrimg: false })) as {
      data?: { qrurl?: string; qrimg?: string };
    };
    const qrContent = body.data?.qrurl ?? '';
    if (!qrContent) throw new TransportError({ message: 'netease /login/qr/create: 缺少 qrurl' });
    return { qrContent, key };
  }

  /** 二维码登录：轮询结果（/login/qr/check）。800 过期 / 801 待扫 / 802 待确认 / 803 成功 */
  async qrCheck(key: string): Promise<{ code: number; message: string; cookie: string }> {
    const body = (await this.req('/login/qr/check', { key }, [200, 800, 801, 802, 803])) as { code?: number; message?: string; cookie?: string };
    return {
      code: body.code ?? 0,
      message: body.message ?? '',
      cookie: body.cookie ?? '',
    };
  }

  // ------------------------------------------------------------ 本期新增

  /** 推荐歌单（/personalized）—— 不需要登录 */
  async personalized(limit = 12): Promise<RecommendPlaylist[]> {
    const body = (await this.req('/personalized', { limit })) as {
      result?: (NEPlaylistRaw & { picUrl?: string; copywriter?: string })[];
    };
    return (body.result ?? []).map((p) => ({
      ...neteasePlaylist(p),
      copywriter: p.copywriter ?? '',
    }));
  }

  /** 榜单列表（/toplist）—— 不需要登录 */
  async toplist(): Promise<ToplistItem[]> {
    const body = (await this.req('/toplist')) as {
      list?: {
        id?: number;
        name?: string;
        coverImgUrl?: string;
        trackCount?: number;
        playCount?: number;
        updateFrequency?: string;
      }[];
    };
    return (body.list ?? []).map((t) => ({
      id: t.id ?? 0,
      name: t.name ?? '',
      cover: t.coverImgUrl ?? '',
      trackCount: t.trackCount ?? 0,
      playCount: fmtCount(t.playCount),
      updateFrequency: t.updateFrequency ?? '',
    }));
  }

  /** 每日推荐（/recommend/songs）—— **需要登录**，未登录时抛出业务码错误 */
  async recommendSongs(): Promise<Song[]> {
    if (!this.cookie()) {
      throw new TransportError({ message: 'netease /recommend/songs: 需要登录（无 cookie）', retryable: false });
    }
    const body = (await this.req('/recommend/songs')) as {
      data?: { dailySongs?: NESongRaw[]; recommendReasons?: { songId?: number; reason?: string }[] };
    };
    return (body.data?.dailySongs ?? [])
      .map((s) => neteaseSong(s))
      .filter((s): s is Song => s !== null);
  }

  /** 热搜（/search/hot） */
  async searchHot(): Promise<HotWord[]> {
    const body = (await this.req('/search/hot')) as {
      result?: { hots?: { first?: string; second?: number; iconType?: number }[] };
    };
    return (body.result?.hots ?? []).map((h, index) => ({
      word: h.first ?? '',
      rank: h.second ?? index + 1,
    })).filter((h) => h.word !== '');
  }

  /** 搜索建议（/search/suggest） */
  async searchSuggest(keywords: string): Promise<string[]> {
    const body = (await this.req('/search/suggest', { keywords })) as {
      result?: { allMatch?: { keyword?: string }[] };
    };
    return (body.result?.allMatch ?? [])
      .map((x) => x.keyword ?? '')
      .filter((x) => x !== '');
  }

  /** 相似歌曲（/simi/song） */
  async similarSongs(id: string | number): Promise<Song[]> {
    const body = (await this.req('/simi/song', { id })) as { songs?: NESongRaw[] };
    return (body.songs ?? []).map((s) => neteaseSong(s)).filter((s): s is Song => s !== null);
  }

  // ------------------------------------------------------------ S5 新增（首页/发现）

  /**
   * 新歌速递（/personalized/newsong）—— 不需要登录。
   *
   * 注意响应形状：每一项是"推荐卡"外壳 { id, name, picUrl, song }，
   * 歌曲实体在 item.song 里，且 item.song.album 是**对象**（不是 al）；
   * 封面优先取 album.picUrl，缺失时退回卡片自带的 picUrl。
   */
  async personalizedNewsong(limit = 12): Promise<Song[]> {
    const body = (await this.req('/personalized/newsong', { limit })) as {
      result?: { id?: number; name?: string; picUrl?: string; song?: NESongRaw }[];
    };
    return (body.result ?? [])
      .map((item) => {
        const raw = item.song;
        if (!raw) return null;
        return neteaseSong(raw, {
          album: { name: raw.album?.name ?? '', picUrl: raw.album?.picUrl ?? item.picUrl ?? '' },
        });
      })
      .filter((s): s is Song => s !== null);
  }

  /**
   * 热搜详情（/search/hot/detail）—— 带名次与热度分。
   *
   * 与 /search/hot 的区别：hot/detail 的 data 是数组，含 score（热度）与 iconUrl，
   * 实测返回 20 条（/search/hot 是 10 条）。名次按数组顺序给，不信服务端排序字段。
   */
  async searchHotDetail(limit = 20): Promise<HotWord[]> {
    const body = (await this.req('/search/hot/detail')) as {
      data?: { searchWord?: string; score?: number }[];
    };
    return (body.data ?? [])
      .map((h, index) => ({ word: h.searchWord ?? '', rank: index + 1, score: h.score ?? 0 }))
      .filter((h) => h.word !== '')
      .slice(0, limit);
  }

  /**
   * 搜索联想（/search/suggest + type=mobile）。
   *
   * 必须带 type=mobile：不带时网易云返回 albums/artists/songs 三个对象，
   * **没有 allMatch**（实测 allMatch 缺席），解析出来永远是空数组。
   * 这里去重后再返回，UI 直接当关键词列表用。
   */
  async suggestKeywords(keywords: string): Promise<string[]> {
    const word = keywords.trim();
    if (!word) return [];
    const body = (await this.req('/search/suggest', { keywords: word, type: 'mobile' })) as {
      result?: { allMatch?: { keyword?: string }[] };
    };
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of body.result?.allMatch ?? []) {
      const kw = item.keyword ?? '';
      if (kw && !seen.has(kw)) {
        seen.add(kw);
        out.push(kw);
      }
    }
    return out;
  }
}

/** 评论瘦身：旧版实测 100 条 ≈130KB → 7 字段约 12KB */
function pickComment(c: NECommentRaw): Comment {
  return {
    commentId: c.commentId,
    content: c.content ?? '',
    likedCount: c.likedCount ?? 0,
    time: c.time ?? 0,
    timeStr: c.timeStr ?? '',
    user: c.user ? { nickname: c.user.nickname ?? '匿名用户', avatarUrl: c.user.avatarUrl ?? '' } : null,
    beReplied: (c.beReplied ?? [])
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({ content: b.content ?? '', nickname: b.user?.nickname ?? '' })),
  };
}

export { isRetryableStatus };
