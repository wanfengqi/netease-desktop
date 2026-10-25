import { describe, expect, it } from 'vitest';
import { NeteaseRepository, type NeteaseBridge } from '../repository/netease';
import { MiguRepository, type MiguBridge } from '../repository/migu';

/**
 * S5 新增接口的解析单测（不联网）。
 *
 * 这些用例锁住的是**真实响应的形状差异**，每一条都对应一个实测踩到的坑：
 *  - /personalized/newsong 的歌曲在 item.song 里，album 是对象不是 al；
 *  - /search/suggest 不带 type=mobile 时压根没有 allMatch；
 *  - /search/hot/detail 的 data 是数组，名次按顺序给；
 *  - 咪咕 getTodayRecommend 的 200205 必须抛不可重试错误（调用方据此降级）。
 */

function neBridge(routes: Record<string, unknown>, calls: { path: string; params?: Record<string, unknown> }[] = []): NeteaseBridge {
  return {
    request: async (path, params) => {
      calls.push({ path, params });
      if (!(path in routes)) return { ok: false, status: 404, body: { error: 'no route ' + path }, ms: 1 };
      return { ok: true, status: 200, body: routes[path], ms: 1 };
    },
  };
}

function mgBridge(routes: Record<string, unknown>): MiguBridge {
  const base: Record<string, unknown> = {};
  const names = [
    'searchSong', 'searchSinger', 'searchAlbum', 'searchPlaylist', 'getUrlH5V24', 'getLyric',
    'getSingerSong', 'getSingerAlbum', 'getAlbumSong', 'getPlaylistSong', 'getSongInfo',
    'getAlbumInfo', 'getTodayRecommend', 'getRankIndex', 'getRecommendPlaylist', 'getNewSongList',
    'getSimilarSongRecommend', 'getSearchHot',
  ];
  for (const name of names) {
    base[name] = async () => {
      const body = routes[name];
      if (body === undefined) return { ok: false, error: 'no route ' + name };
      // MiguCallResult 的壳：{ ok, data }，data 是 SDK 原始响应
      return { ok: true, data: body };
    };
  }
  return base as unknown as MiguBridge;
}

describe('netease: /personalized/newsong（新歌速递）', () => {
  it('从 item.song 取歌曲，封面回退到 item.picUrl', async () => {
    const repo = new NeteaseRepository({
      bridge: neBridge({
        '/personalized/newsong': {
          code: 200,
          result: [
            {
              id: 111,
              name: '宝船',
              picUrl: 'http://p1/card.jpg',
              song: {
                id: 111,
                name: '宝船',
                // fee===1 才是 VIP（normalize 层的既有语义）；实测新歌多为 fee=8（付费专辑）
                fee: 1,
                duration: 232500,
                artists: [{ name: 'DOUDOU' }, { name: '燕云十六声' }],
                album: { name: '宝船', picUrl: 'http://p1/album.jpg' },
                privilege: { big: 'field' },
              },
            },
            {
              id: 222,
              name: '无专辑封面',
              picUrl: 'http://p1/fallback.jpg',
              song: { id: 222, name: '无专辑封面', artists: [{ name: 'X' }], duration: 1000 },
            },
          ],
        },
      }),
    });

    const songs = await repo.personalizedNewsong(12);
    expect(songs).toHaveLength(2);
    expect(songs[0]).toEqual({
      source: 'netease',
      id: 111,
      name: '宝船',
      artists: [{ name: 'DOUDOU' }, { name: '燕云十六声' }],
      artistText: 'DOUDOU / 燕云十六声',
      album: { name: '宝船', picUrl: 'http://p1/album.jpg' },
      duration: 232500,
      vip: true,
    });
    // 没有 album.picUrl 时用卡片自带的图，不留空封面
    expect(songs[1].album.picUrl).toBe('http://p1/fallback.jpg');
    // 瘦身：原始 privilege 不外泄
    expect(songs[0]).not.toHaveProperty('privilege');
  });

  it('缺少 song 子对象的项被丢掉，不产生空歌曲', async () => {
    const repo = new NeteaseRepository({
      bridge: neBridge({ '/personalized/newsong': { code: 200, result: [{ id: 1 }, { song: { id: 2, name: 'ok' } }] } }),
    });
    const songs = await repo.personalizedNewsong();
    expect(songs.map((s) => s.id)).toEqual([2]);
  });

  it('result 缺失时返回空数组（不抛错）', async () => {
    const repo = new NeteaseRepository({ bridge: neBridge({ '/personalized/newsong': { code: 200 } }) });
    await expect(repo.personalizedNewsong()).resolves.toEqual([]);
  });
});

describe('netease: /search/hot/detail（热搜详情）', () => {
  it('按数组顺序给名次，保留 score', async () => {
    const repo = new NeteaseRepository({
      bridge: neBridge({
        '/search/hot/detail': {
          code: 200,
          data: [
            { searchWord: '季候风', score: 76756 },
            { searchWord: '天龙八部之宿敌', score: 75534 },
            { searchWord: '', score: 1 },
          ],
        },
      }),
    });
    const words = await repo.searchHotDetail(20);
    expect(words).toEqual([
      { word: '季候风', rank: 1, score: 76756 },
      { word: '天龙八部之宿敌', rank: 2, score: 75534 },
    ]);
  });

  it('limit 生效，且空 data 返回空数组', async () => {
    const repo = new NeteaseRepository({
      bridge: neBridge({
        '/search/hot/detail': { code: 200, data: Array.from({ length: 20 }, (_, i) => ({ searchWord: 'w' + i, score: i })) },
      }),
    });
    expect(await repo.searchHotDetail(5)).toHaveLength(5);
    const empty = new NeteaseRepository({ bridge: neBridge({ '/search/hot/detail': { code: 200 } }) });
    await expect(empty.searchHotDetail()).resolves.toEqual([]);
  });
});

describe('netease: /search/suggest（联想）', () => {
  it('必须带 type=mobile 才拿得到 allMatch', async () => {
    const calls: { path: string; params?: Record<string, unknown> }[] = [];
    const repo = new NeteaseRepository({
      bridge: neBridge(
        { '/search/suggest': { code: 200, result: { allMatch: [{ keyword: '周杰伦' }, { keyword: '周杰伦晴天' }] } } },
        calls,
      ),
    });
    const words = await repo.suggestKeywords('周杰伦');
    expect(words).toEqual(['周杰伦', '周杰伦晴天']);
    expect(calls[0].params).toMatchObject({ keywords: '周杰伦', type: 'mobile' });
  });

  it('去重并保持首次出现顺序', async () => {
    const repo = new NeteaseRepository({
      bridge: neBridge({
        '/search/suggest': { code: 200, result: { allMatch: [{ keyword: 'A' }, { keyword: 'B' }, { keyword: 'A' }, { keyword: '' }] } },
      }),
    });
    expect(await repo.suggestKeywords('a')).toEqual(['A', 'B']);
  });

  it('空关键词直接返回空数组，不发请求', async () => {
    const calls: { path: string; params?: Record<string, unknown> }[] = [];
    const repo = new NeteaseRepository({ bridge: neBridge({}, calls) });
    expect(await repo.suggestKeywords('   ')).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('migu: 每日推荐的已知限制（200205）', () => {
  const BODY_200205 = { code: '000000', data: { code: '200205', info: '手机号和IMEI不能同时为空' }, newPacmToken: '' };

  it('todayRecommendSongs 在 200205 时抛不可重试错误（调用方据此降级）', async () => {
    const repo = new MiguRepository({ bridge: mgBridge({ getTodayRecommend: BODY_200205 }) });
    await expect(repo.todayRecommendSongs('')).rejects.toMatchObject({ retryable: false });
    await expect(repo.todayRecommendSongs('')).rejects.toThrow(/200205/);
  });

  it('成功响应里没有 songList/contents 时返回空数组，不编造数据', async () => {
    const repo = new MiguRepository({
      bridge: mgBridge({ getTodayRecommend: { code: '000000', data: { code: '000000' }, newPacmToken: 't2' } }),
    });
    await expect(repo.todayRecommendSongs('t1')).resolves.toEqual([]);
  });

  it('成功响应带 songList 时归一化成统一 Song', async () => {
    const repo = new MiguRepository({
      bridge: mgBridge({
        getTodayRecommend: {
          code: '000000',
          data: {
            code: '000000',
            songList: [
              {
                contentId: '600930000004278658',
                copyrightId: 'cp1',
                songName: '月下签',
                singerList: [{ name: '蒲熠星' }],
                album: '专辑A',
                img1: '/data/oss/a.webp',
                duration: 240,
                showTags: ['vip'],
              },
            ],
          },
          newPacmToken: 't2',
        },
      }),
    });
    const songs = await repo.todayRecommendSongs('t1');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      source: 'migu',
      id: '600930000004278658',
      name: '月下签',
      artistText: '蒲熠星',
      duration: 240000, // 咪咕给秒，统一成毫秒
      vip: true,
    });
    expect(songs[0].album.picUrl).toBe('https://d.musicapp.migu.cn/data/oss/a.webp');
  });
});
