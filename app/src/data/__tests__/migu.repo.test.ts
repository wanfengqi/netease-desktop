import { describe, expect, it } from 'vitest';
import { MiguRepository, type MiguBridge } from '../repository/migu';
import { TransportError } from '../transport';
import type { Song } from '../normalize';

function ok(data: unknown) {
  return { ok: true, data: { code: '000000', info: '操作成功', data } };
}

/** 只实现测试用到的方法，其余给一个会抛错的占位 */
function bridge(partial: Partial<MiguBridge>): MiguBridge {
  const missing = (name: string) => async () => {
    throw new Error('未预期调用 ' + name);
  };
  return {
    searchSong: missing('searchSong'),
    searchSinger: missing('searchSinger'),
    searchAlbum: missing('searchAlbum'),
    searchPlaylist: missing('searchPlaylist'),
    getUrlH5V24: missing('getUrlH5V24'),
    getLyric: missing('getLyric'),
    getSingerSong: missing('getSingerSong'),
    getSingerAlbum: missing('getSingerAlbum'),
    getAlbumSong: missing('getAlbumSong'),
    getPlaylistSong: missing('getPlaylistSong'),
    getSongInfo: missing('getSongInfo'),
    getAlbumInfo: missing('getAlbumInfo'),
    getTodayRecommend: missing('getTodayRecommend'),
    getRankIndex: missing('getRankIndex'),
    getRecommendPlaylist: missing('getRecommendPlaylist'),
    getNewSongList: missing('getNewSongList'),
    getSimilarSongRecommend: missing('getSimilarSongRecommend'),
    getSearchHot: missing('getSearchHot'),
    fetchText: async () => ({ ok: true, text: '' }),
    ...partial,
  } as MiguBridge;
}

const MIGU_SONG = {
  contentId: '600902000006889366',
  songId: '3790007',
  songName: '晴天',
  singerList: [{ id: '112', name: '周杰伦' }],
  album: '叶惠美',
  img1: '/data/oss/resource/00/4t/x.webp',
  duration: 270,
  showTags: ['vip', 'isq'],
  copyrightId: '60054701923',
  resourceType: '2',
  audioFormats: new Array(4).fill({ resourceType: '2', formatType: 'PQ', isize: '1' }),
  track: '{"appId":"s900"}',
};

describe('migu repository: 搜索与瘦身', () => {
  it('searchSongs 秒转毫秒、图片拼前缀、丢掉 audioFormats/track', async () => {
    const repo = new MiguRepository({
      bridge: bridge({ searchSong: async () => ok({ items: [{ song: MIGU_SONG }], hasNext: true }) }),
    });
    const paged = await repo.searchSongs('周杰伦', { limit: 10 });
    expect(paged.hasMore).toBe(true);
    const s = paged.items[0];
    expect(s).toEqual({
      source: 'migu',
      id: '600902000006889366',
      contentId: '600902000006889366',
      copyrightId: '60054701923',
      resourceType: '2',
      name: '晴天',
      artists: [{ name: '周杰伦' }],
      artistText: '周杰伦',
      album: { name: '叶惠美', picUrl: 'https://d.musicapp.migu.cn/data/oss/resource/00/4t/x.webp' },
      duration: 270000,
      vip: true,
    });
    expect(s).not.toHaveProperty('audioFormats');
    expect(s).not.toHaveProperty('track');
  });

  it('searchArtists 走 imgs 里 02 尺寸的图', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        searchSinger: async () => ok({
          items: [{ singer: { singerId: '112', singer: '周杰伦', songNum: 582, albumNum: 45, summary: ' 简介 ', imgs: [{ imgSizeType: '01', img: '/a.webp' }, { imgSizeType: '02', img: '/b.webp' }] } }],
        }),
      }),
    });
    const paged = await repo.searchArtists('周杰伦');
    expect(paged.items[0]).toEqual({
      source: 'migu', id: '112', name: '周杰伦',
      avatar: 'https://d.musicapp.migu.cn/b.webp', songNum: 582, albumNum: 45, brief: '简介',
    });
  });

  it('searchAlbums 从 dalbum 取（字段名与 ZJ-Album-Item 不同）', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        searchAlbum: async () => ok({
          items: [{ dalbum: { contentId: '600927015009000944', title: '太阳之子', totalCount: 12, publishDate: '2026-03-19', imgItems: [{ imgSizeType: '02', img: '/al.webp' }] } }],
        }),
      }),
    });
    const paged = await repo.searchAlbums('周杰伦');
    expect(paged.items[0]).toEqual({
      source: 'migu', id: '600927015009000944', name: '太阳之子',
      cover: 'https://d.musicapp.migu.cn/al.webp', date: '2026-03-19', size: 12,
    });
  });

  it('searchPlaylists 拆 musicList 包装', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        searchPlaylist: async () => ok({
          items: [{ musicList: { musicListId: '225158198', title: '周杰伦', musicNum: 309, ownerName: 'u', imgItem: { img: '/pl.webp' } } }],
        }),
      }),
    });
    const paged = await repo.searchPlaylists('周杰伦');
    expect(paged.items[0]).toMatchObject({
      source: 'migu', id: '225158198', name: '周杰伦', count: 309,
      cover: 'https://d.musicapp.migu.cn/pl.webp',
    });
  });
});

describe('migu repository: 详情', () => {
  it('singerSongs 只取 ZJ-Singer-Song-Scroll 块', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getSingerSong: async () => ok({
          contents: [
            { view: 'ZJ-Img-Scroll', contents: [{ txt: '广告位', img: '/ad.webp' }] },
            { view: 'ZJ-Singer-Song-Scroll', contents: [{ resId: '600929000000096577', txt: '圣诞星', txt2: '周杰伦', txt3: '圣诞星' }] },
          ],
        }),
      }),
    });
    const songs = await repo.singerSongs('112');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id: '600929000000096577', name: '圣诞星', artistText: '周杰伦' });
  });

  it('playlistSongs 透出 total 与 hasMore', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getPlaylistSong: async () => ok({ totalCount: 309, songList: [MIGU_SONG] }),
      }),
    });
    const paged = await repo.playlistSongs('225158198', { limit: 5 });
    expect(paged.total).toBe(309);
    expect(paged.hasMore).toBe(true);
    expect(paged.items[0].duration).toBe(270000);
  });

  it('albumSongs 空列表也能正常返回（咪咕实测常返回 songList:[]）', async () => {
    const repo = new MiguRepository({
      bridge: bridge({ getAlbumSong: async () => ok({ songList: [], hasNext: false }) }),
    });
    await expect(repo.albumSongs('x')).resolves.toEqual({ items: [], hasMore: false });
  });

  it('singerAlbums 从 contents 的 ZJ-Album-Item 取，hasNext 来自 header', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getSingerAlbum: async () => ok({
          header: { hasNext: true },
          contents: [{ view: 'ZJ-Album-Item', resId: '600927015009001083', txt: '太阳之子', txt3: '2026-03-19', img: 'https://d.musicapp.migu.cn/x.webp' }],
        }),
      }),
    });
    const paged = await repo.singerAlbums('112');
    expect(paged.hasMore).toBe(true);
    expect(paged.items[0]).toMatchObject({ id: '600927015009001083', name: '太阳之子', date: '2026-03-19' });
  });
});

describe('migu repository: 歌词与取址', () => {
  it('lyric 直接给 lrc 时不再拉文本', async () => {
    const fetchText = async () => {
      throw new Error('不应调用 fetchText');
    };
    const repo = new MiguRepository({
      bridge: bridge({ getLyric: async () => ({ ok: true, data: { success: true, lrc: '[00:01.00]晴天' } }), fetchText }),
    });
    await expect(repo.lyric('600902000006889366')).resolves.toEqual({ lyric: '[00:01.00]晴天', translation: '' });
  });

  it('lyric 只有 lrcUrl 时回落到拉文本', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getLyric: async () => ({ ok: true, data: { success: true, lrcUrl: 'https://d/lrc' } }),
        fetchText: async () => ({ ok: true, text: '[00:02.00]文本歌词' }),
      }),
    });
    await expect(repo.lyric('x')).resolves.toEqual({ lyric: '[00:02.00]文本歌词', translation: '' });
  });

  it('songUrl 用 contentId + copyrightId 调 getUrlH5V24', async () => {
    const seen: unknown[] = [];
    const repo = new MiguRepository({
      bridge: bridge({
        getUrlH5V24: async (...args) => {
          seen.push(args);
          return { ok: true, data: { code: '000000', data: { url: 'https://freetyst/x.mp3', audioFormatType: 'PQ', auditionsLength: 0 } } };
        },
      }),
    });
    const song = { id: '1', source: 'migu', contentId: '1', copyrightId: '2', resourceType: '2' } as Song;
    await expect(repo.songUrl(song)).resolves.toMatchObject({ url: 'https://freetyst/x.mp3', level: 'PQ', auditionMs: 0 });
    expect(seen[0]).toEqual(['1', '2', 'PQ']);
  });

  it('songUrl 缺 copyrightId 时抛不可重试错误', async () => {
    const repo = new MiguRepository({ bridge: bridge({}) });
    const song = { id: '1', source: 'migu', contentId: '1' } as Song;
    await expect(repo.songUrl(song)).rejects.toBeInstanceOf(TransportError);
    await expect(repo.songUrl(song)).rejects.toMatchObject({ retryable: false });
  });

  it('无可用地址时返回 url:null + reason，不抛错', async () => {
    const repo = new MiguRepository({
      bridge: bridge({ getUrlH5V24: async () => ({ ok: true, data: { code: '000000', data: {} } }) }),
    });
    const song = { id: '1', source: 'migu', contentId: '1', copyrightId: '2' } as Song;
    const result = await repo.songUrl(song);
    expect(result.url).toBeNull();
    expect(result.reason).toContain('会员');
  });
});

describe('migu repository: 新增接口', () => {
  it('rankIndex 拆分组并给图片拼前缀', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getRankIndex: async () => ok({
          contents: [{ style: '咪咕特色榜', contents: [{ rankId: '83048887', rankName: '全网热歌榜', imageUrl: '/r.webp' }] }],
        }),
      }),
    });
    const groups = await repo.rankIndex();
    expect(groups).toEqual([{
      style: '咪咕特色榜',
      ranks: [{ rankId: '83048887', rankName: '全网热歌榜', imageUrl: 'https://d.musicapp.migu.cn/r.webp' }],
    }]);
  });

  it('recommendPlaylists 从 playLists 取（resId/txt/img 结构）', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getRecommendPlaylist: async () => ok({ playLists: [{ resId: '236792651', txt: '麦霸指南', img: 'https://cdn/x.png' }] }),
      }),
    });
    const list = await repo.recommendPlaylists();
    expect(list[0]).toMatchObject({ source: 'migu', id: '236792651', name: '麦霸指南', cover: 'https://cdn/x.png' });
  });

  it('newSongTabs 如实返回导航壳（不含歌曲实体）', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getNewSongList: async () => ok({
          contentItemList: [{ itemList: [{ title: '全部', actionUrl: 'http://a?start=1' }, { title: '华语', actionUrl: 'http://a?start=2' }] }],
        }),
      }),
    });
    const tabs = await repo.newSongTabs();
    expect(tabs).toEqual([
      { title: '全部', url: 'http://a?start=1' },
      { title: '华语', url: 'http://a?start=2' },
    ]);
  });

  it('similarSongs 空 contents 返回空数组（实测常见）', async () => {
    const repo = new MiguRepository({
      bridge: bridge({ getSimilarSongRecommend: async () => ok({ contents: [] }) }),
    });
    await expect(repo.similarSongs('1')).resolves.toEqual([]);
  });

  it('searchHot 从 data 数组（不是对象）里抽词', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        getSearchHot: async () => ({ ok: true, data: { code: '000000', data: [{ tabName: '搜索飙升', searchRankList: [{ word: '月下签', rank: 1 }] }] } }),
      }),
    });
    await expect(repo.searchHot()).resolves.toEqual([{ word: '月下签', rank: 1 }]);
  });

  it('todayRecommend 未登录时业务码 200205 直接抛不可重试错误', async () => {
    const repo = new MiguRepository({
      bridge: bridge({
        // 实测原始形状：{ data: { code, info }, newPacmToken }
        getTodayRecommend: async () => ({ ok: true, data: { data: { code: '200205', info: '手机号和IMEI不能同时为空' }, newPacmToken: '' } }),
      }),
      retries: 0,
    });
    await expect(repo.todayRecommend('')).rejects.toMatchObject({ retryable: false });
  });
});

describe('migu repository: 错误与重试', () => {
  it('SDK 调用失败（ok:false）抛可重试的 TransportError', async () => {
    const repo = new MiguRepository({
      bridge: bridge({ searchSong: async () => ({ ok: false, error: 'ECONNRESET' }) }),
      retries: 0,
    });
    await expect(repo.searchSongs('x')).rejects.toMatchObject({ retryable: true });
  });

  it('咪咕业务码非 000000 时抛不可重试错误', async () => {
    const repo = new MiguRepository({
      bridge: bridge({ searchSong: async () => ({ ok: true, data: { code: '-1', info: '参数错误' } }) }),
      retries: 0,
    });
    await expect(repo.searchSongs('x')).rejects.toMatchObject({ retryable: false });
  });
});
