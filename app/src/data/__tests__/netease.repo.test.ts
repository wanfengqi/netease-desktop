import { describe, expect, it, vi } from 'vitest';
import { NeteaseRepository, type NeteaseBridge } from '../repository/netease';
import { TransportError } from '../transport';

/** 造一个可控的网易云 bridge：记录调用参数，按路径返回预设 body */
function bridge(routes: Record<string, unknown>, calls: { path: string; params?: Record<string, unknown> }[] = []): NeteaseBridge {
  return {
    request: async (path, params) => {
      calls.push({ path, params });
      if (!(path in routes)) {
        return { ok: false, status: 404, body: { error: 'no route ' + path }, ms: 1 };
      }
      return { ok: true, status: 200, body: routes[path], ms: 1 };
    },
  };
}

const SONG_RAW = {
  id: 186016,
  name: '晴天',
  ar: [{ name: '周杰伦' }],
  al: { name: '叶惠美', picUrl: 'https://p1/x.jpg' },
  dt: 269000,
  fee: 0,
  // 下面这些大字段必须被 picker 丢掉
  privilege: { flag: 1541124, chargeInfoList: new Array(50).fill({ rate: 128000 }) },
  h: { bitrate: 320000, sq: { br: 999000 } },
  track: '{"appId":"s900"}',
};

describe('netease repository: picker 瘦身', () => {
  it('searchSongs 只透出统一 Song 字段，原始大字段不外泄', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({ '/cloudsearch': { code: 200, result: { songs: [SONG_RAW], songCount: 1 } } }),
    });
    const paged = await repo.searchSongs('周杰伦', { limit: 10 });
    expect(paged.items).toHaveLength(1);
    const s = paged.items[0];
    expect(s).toEqual({
      source: 'netease',
      id: 186016,
      name: '晴天',
      artists: [{ name: '周杰伦' }],
      artistText: '周杰伦',
      album: { name: '叶惠美', picUrl: 'https://p1/x.jpg' },
      duration: 269000,
      vip: false,
    });
    expect(s).not.toHaveProperty('privilege');
    expect(s).not.toHaveProperty('h');
    expect(s).not.toHaveProperty('track');
    expect(paged.total).toBe(1);
  });

  it('playlistDetail 返回精简 playlist + tracks（丢掉整份 300KB 响应）', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({
        '/playlist/detail': {
          code: 200,
          playlist: {
            id: 999,
            name: '歌单',
            coverImgUrl: 'c',
            trackCount: 1,
            playCount: 34142364,
            creator: { nickname: 'u', avatarUrl: 'big' },
            tracks: [SONG_RAW],
            subscribers: new Array(100).fill({}),
            commentCount: 12,
          },
        },
      }),
    });
    const result = await repo.playlistDetail(999);
    expect(result.playlist).toEqual({
      source: 'netease', id: 999, name: '歌单', cover: 'c', creator: 'u', count: 1, playCount: '3414.2万',
    });
    expect(result.playlist).not.toHaveProperty('subscribers');
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).not.toHaveProperty('privilege');
  });

  it('comments 把 27 字段的评论裁成 7 字段', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({
        '/comment/music': {
          code: 200,
          more: true,
          total: 1970225,
          hotComments: [{ commentId: 1, content: 'hot', user: { nickname: 'A', avatarUrl: 'av' }, beReplied: [] }],
          comments: [{
            commentId: 2,
            content: 'c',
            likedCount: 5,
            time: 1,
            timeStr: 'x',
            user: { nickname: 'B', avatarUrl: 'av2', vipRights: {}, locationInfo: {} },
            beReplied: [{ content: 're', user: { nickname: 'C' }, decoration: {} }],
            richContent: '...',
            likeAnimationMap: {},
          }],
        },
      }),
    });
    const result = await repo.comments(186016, { limit: 20 });
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(1970225);
    expect(result.hot).toHaveLength(1);
    expect(result.items[0]).toEqual({
      commentId: 2,
      content: 'c',
      likedCount: 5,
      time: 1,
      timeStr: 'x',
      user: { nickname: 'B', avatarUrl: 'av2' },
      beReplied: [{ content: 're', nickname: 'C' }],
    });
    expect(result.items[0]).not.toHaveProperty('richContent');
    expect(result.items[0].user).not.toHaveProperty('vipRights');
  });
});

describe('netease repository: 新增接口', () => {
  it('personalized 不需要登录，返回推荐歌单 + 文案', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({
        '/personalized': {
          code: 200,
          result: [{ id: 1, name: 'pl', picUrl: 'p', playCount: 12000, copywriter: '根据你喜欢的歌曲推荐' }],
        },
      }),
    });
    const list = await repo.personalized(3);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: 'netease', id: 1, name: 'pl', playCount: '1.2万', copywriter: '根据你喜欢的歌曲推荐' });
  });

  it('toplist 返回榜单摘要', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({
        '/toplist': { code: 200, list: [{ id: 19723756, name: '飙升榜', coverImgUrl: 'c', trackCount: 100, playCount: 340000000, updateFrequency: '每天更新' }] },
      }),
    });
    const list = await repo.toplist();
    expect(list[0]).toEqual({ id: 19723756, name: '飙升榜', cover: 'c', trackCount: 100, playCount: '3.4亿', updateFrequency: '每天更新' });
  });

  it('searchHot / searchSuggest / similarSongs 窄返回', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({
        '/search/hot': { code: 200, result: { hots: [{ first: '周杰伦', second: 1 }, { first: '晴天', second: 2 }] } },
        '/search/suggest': { code: 200, result: { allMatch: [{ keyword: '周杰伦 晴天' }, {}] } },
        '/simi/song': { code: 200, songs: [SONG_RAW] },
      }),
    });
    expect(await repo.searchHot()).toEqual([{ word: '周杰伦', rank: 1 }, { word: '晴天', rank: 2 }]);
    expect(await repo.searchSuggest('周')).toEqual(['周杰伦 晴天']);
    expect((await repo.similarSongs(186016))[0].name).toBe('晴天');
  });

  it('recommendSongs 无 cookie 时抛不可重试的业务错误（而不是发请求）', async () => {
    const request = vi.fn();
    const repo = new NeteaseRepository({ bridge: { request }, getCookie: () => '' });
    await expect(repo.recommendSongs()).rejects.toBeInstanceOf(TransportError);
    await expect(repo.recommendSongs()).rejects.toMatchObject({ retryable: false });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('netease repository: 取址与错误', () => {
  it('songUrl 无版权时返回 url:null + reason（不是抛错）', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({ '/song/url/v1': { code: 200, data: [{ id: 1, url: null, br: 0, code: 404 }] } }),
    });
    const result = await repo.songUrl(1);
    expect(result.url).toBeNull();
    expect(result.reason).toContain('404');
  });

  it('songUrl 有地址时原样返回并带码率', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({ '/song/url/v1': { code: 200, data: [{ url: 'https://m/x.mp3', br: 128008, code: 200 }] } }),
    });
    await expect(repo.songUrl(1)).resolves.toMatchObject({ url: 'https://m/x.mp3', br: 128008, auditionMs: 0 });
  });

  it('业务码非 200 时抛错（HTTP 200 不等于成功）', async () => {
    const repo = new NeteaseRepository({
      bridge: bridge({ '/cloudsearch': { code: 301, msg: '需要登录' } }),
      retries: 0,
    });
    await expect(repo.searchSongs('x')).rejects.toMatchObject({ retryable: false });
  });

  it('5xx 会重试，重试成功后正常返回', async () => {
    let calls = 0;
    const repo = new NeteaseRepository({
      bridge: {
        request: async () => {
          calls += 1;
          if (calls === 1) return { ok: false, status: 503, body: {}, ms: 1 };
          return { ok: true, status: 200, body: { code: 200, result: { songs: [] } }, ms: 1 };
        },
      },
      retries: 1,
      delay: async () => {},
    });
    await expect(repo.searchSongs('x')).resolves.toMatchObject({ items: [] });
    expect(calls).toBe(2);
  });

  it('cookie 从 getCookie 注入并透传给 bridge', async () => {
    const calls: { path: string; params?: Record<string, unknown> }[] = [];
    const repo = new NeteaseRepository({
      bridge: bridge({ '/login/status': { code: 200, data: { profile: { nickname: '我', userId: 7 } } } }, calls),
      getCookie: () => 'MUSIC_U=abc',
    });
    await expect(repo.loginState()).resolves.toEqual({ loggedIn: true, nickname: '我', userId: 7 });
    expect(calls[0].path).toBe('/login/status');
  });

  it('无 cookie 时 loginState 直接返回未登录且不发请求', async () => {
    const request = vi.fn();
    const repo = new NeteaseRepository({ bridge: { request } });
    await expect(repo.loginState()).resolves.toEqual({ loggedIn: false, nickname: '', userId: null });
    expect(request).not.toHaveBeenCalled();
  });
});
