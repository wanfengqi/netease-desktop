import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Song } from '../../data/normalize';
import type { HotWord, RecommendPlaylist, ToplistItem } from '../../data/repository/types';
import {
  LoginRequiredError,
  UnsupportedError,
  classifyError,
  defaultHomeSource,
  useHomeStore,
} from '../home';

/**
 * 首页 store 的单测重点只有两个：
 *  1. 区块三态真的会转（loading -> ready / empty / error），且互不污染；
 *  2. 接口失败时降级成什么状态（登录缺失 / 接口不可用 / 真错误）——
 *     这三种在 UI 上是三种不同的样子，混淆会把"没登录"显示成"网络坏了"。
 *
 * 配置 store 依赖 window.api.config，这里只用到它的 cookie/source/recent 三个 getter，
 * 直接 mock 掉整个 stores/config 模块，避免把 Electron 环境拖进单测。
 */

const configState = {
  cookie: '',
  source: 'netease' as 'netease' | 'migu',
  recent: [] as Song[],
};

vi.mock('../config', () => ({
  useConfigStore: () => configState,
}));

function song(id: number, name = '歌' + id): Song {
  return {
    source: 'netease',
    id,
    name,
    artistText: '歌手',
    artists: [{ name: '歌手' }],
    album: { name: '专辑', picUrl: '' },
    duration: 200000,
    vip: false,
  };
}

function playlist(id: number): RecommendPlaylist {
  return {
    source: 'netease',
    id,
    name: '歌单' + id,
    cover: '',
    creator: '',
    count: 10,
    playCount: '1.2万',
    copywriter: '',
  };
}

function toplist(i: number): ToplistItem {
  return { id: i, name: '榜' + i, cover: '', trackCount: 100, playCount: '1亿', updateFrequency: '每天更新' };
}

function hot(i: number): HotWord {
  return { word: '热词' + i, rank: i, score: 100 - i };
}

/** 默认数据源：全部成功 */
function okSource(): Parameters<ReturnType<typeof useHomeStore>['configure']>[0] {
  return {
    recommendPlaylists: async () => [playlist(1), playlist(2)],
    newSongs: async () => [song(1), song(2), song(3)],
    dailySongs: async () => [song(10), song(11)],
    toplists: async () => [toplist(1), toplist(2)],
    miguRanks: async () => [
      { style: '咪咕特色榜', ranks: [{ rankId: 'r1', rankName: '全网热歌榜', imageUrl: '' }] },
    ],
    hotWords: async () => [hot(1), hot(2)],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  configState.cookie = '';
  configState.source = 'netease';
  configState.recent = [];
});

describe('home store: 三态转换', () => {
  it('loadHome 全部成功时五个区块都进 ready，条数与接口返回一致', async () => {
    const store = useHomeStore();
    store.configure(okSource());
    await store.loadHome();

    expect(store.recommend.status).toBe('ready');
    expect(store.recommend.items).toHaveLength(2);
    expect(store.newSongs.status).toBe('ready');
    expect(store.newSongs.items).toHaveLength(3);
    expect(store.daily.status).toBe('ready');
    expect(store.daily.items).toHaveLength(2);
    expect(store.hot.status).toBe('ready');
    expect(store.hot.items).toHaveLength(2);
    // loadHome 不拉榜单（那是 DiscoverView 的事）
    expect(store.toplists.status).toBe('idle');
  });

  it('空数组进 empty 而不是 ready（UI 要能区分"有 0 条"和"加载完了"）', async () => {
    const store = useHomeStore();
    store.configure({ ...okSource(), recommendPlaylists: async () => [] });
    await store.loadRecommend();
    expect(store.recommend.status).toBe('empty');
    expect(store.recommend.items).toHaveLength(0);
    expect(store.recommend.error).toBe('');
  });

  it('加载过程中状态是 loading（骨架屏有东西可渲染）', async () => {
    const store = useHomeStore();
    let release: (v: RecommendPlaylist[]) => void = () => {};
    const pending = new Promise<RecommendPlaylist[]>((resolve) => {
      release = resolve;
    });
    store.configure({ ...okSource(), recommendPlaylists: () => pending });

    const task = store.loadRecommend();
    expect(store.recommend.status).toBe('loading');
    release([playlist(9)]);
    await task;
    expect(store.recommend.status).toBe('ready');
    expect(store.recommend.items[0].id).toBe(9);
  });

  it('一个区块失败不影响其它区块（并发隔离）', async () => {
    const store = useHomeStore();
    store.configure({
      ...okSource(),
      recommendPlaylists: async () => {
        throw new Error('接口 500');
      },
    });
    await store.loadHome();

    expect(store.recommend.status).toBe('error');
    expect(store.recommend.error).toContain('500');
    expect(store.newSongs.status).toBe('ready');
    expect(store.newSongs.items).toHaveLength(3);
    expect(store.daily.status).toBe('ready');
  });

  it('重试会覆盖先前的错误态（force=true 跳过 ready 短路）', async () => {
    const store = useHomeStore();
    let fail = true;
    store.configure({
      ...okSource(),
      toplists: async () => {
        if (fail) throw new Error('第一次失败');
        return [toplist(7)];
      },
    });

    await store.loadToplists();
    expect(store.toplists.status).toBe('error');

    fail = false;
    await store.loadToplists();
    // 非 force 时错误态不会短路，会真的重试
    expect(store.toplists.status).toBe('ready');
    expect(store.toplists.items[0].id).toBe(7);
  });

  it('已 ready 的区块不会因为再次调用而重复拉取（除非 force）', async () => {
    const store = useHomeStore();
    const spy = vi.fn(async () => [playlist(1)]);
    store.configure({ ...okSource(), recommendPlaylists: spy });

    await store.loadRecommend();
    await store.loadRecommend();
    expect(spy).toHaveBeenCalledTimes(1);

    await store.loadRecommend(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('home store: 每日推荐的降级（已知接口限制）', () => {
  it('网易云无 cookie -> login-required（走真实数据源，不发网络请求）', async () => {
    const store = useHomeStore();
    store.resetSource(); // 用 defaultHomeSource：无 cookie 时在发请求之前就抛
    configState.cookie = '';
    configState.source = 'netease';

    await store.loadDaily();
    expect(store.daily.status).toBe('login-required');
    expect(store.daily.error).toContain('登录');
    expect(store.daily.items).toHaveLength(0);
  });

  it('咪咕音源 -> unsupported（200205 已知限制），不是 error', async () => {
    const store = useHomeStore();
    store.resetSource();
    configState.source = 'migu';

    await store.loadDaily();
    expect(store.daily.status).toBe('unsupported');
    expect(store.daily.error).toContain('200205');
  });

  it('有 cookie 时网易云每日推荐会真的尝试请求（失败则落 error，不会假装 login-required）', async () => {
    const store = useHomeStore();
    // 用假源模拟"有 cookie 但请求失败"：状态必须是 error
    store.configure({
      ...okSource(),
      dailySongs: async () => {
        throw new Error('netease /recommend/songs: 网络不可达');
      },
    });
    configState.cookie = 'MUSIC_U=fake';
    await store.loadDaily();
    expect(store.daily.status).toBe('error');
  });

  it('LoginRequiredError 被归到 login-required 而不是 error', async () => {
    const store = useHomeStore();
    store.configure({
      ...okSource(),
      dailySongs: async () => {
        throw new LoginRequiredError('网易云每日推荐需要登录');
      },
    });
    await store.loadDaily();
    expect(store.daily.status).toBe('login-required');
  });

  it('UnsupportedError（咪咕 200205）被归到 unsupported 而不是 error', async () => {
    const store = useHomeStore();
    store.configure({
      ...okSource(),
      dailySongs: async () => {
        throw new UnsupportedError('咪咕每日推荐需要 pacmToken');
      },
    });
    await store.loadDaily();
    expect(store.daily.status).toBe('unsupported');
    expect(store.daily.error).toContain('pacmToken');
  });

  it('真实错误仍是 error —— 不能把所有失败都说成"需要登录"', async () => {
    const store = useHomeStore();
    store.configure({
      ...okSource(),
      dailySongs: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:3500');
      },
    });
    await store.loadDaily();
    expect(store.daily.status).toBe('error');
    expect(store.daily.error).toContain('ECONNREFUSED');
  });
});

describe('classifyError', () => {
  it('按异常类型分派三种状态', () => {
    expect(classifyError(new LoginRequiredError('x')).status).toBe('login-required');
    expect(classifyError(new UnsupportedError('x')).status).toBe('unsupported');
    expect(classifyError(new Error('boom')).status).toBe('error');
  });

  it('没有类型信息时按文案兜底（repository 抛的是普通 TransportError）', () => {
    expect(classifyError(new Error('netease /recommend/songs: 需要登录（无 cookie）')).status).toBe(
      'login-required',
    );
    expect(classifyError(new Error('migu getTodayRecommend: 咪咕返回 200205')).status).toBe('unsupported');
  });
});

describe('defaultHomeSource: 真实降级路径（不联网）', () => {
  it('咪咕每日推荐在没有 pacmToken 时抛 UnsupportedError（不发请求）', async () => {
    await expect(
      defaultHomeSource.dailySongs({ source: 'migu', cookie: '', pacmToken: '' }),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  it('网易云每日推荐在无 cookie 时抛 LoginRequiredError（不发请求）', async () => {
    await expect(
      defaultHomeSource.dailySongs({ source: 'netease', cookie: '', pacmToken: '' }),
    ).rejects.toBeInstanceOf(LoginRequiredError);
  });

  it('两个错误经过 classifyError 后分别是 unsupported / login-required', async () => {
    const miguErr = await defaultHomeSource
      .dailySongs({ source: 'migu', cookie: '', pacmToken: '' })
      .catch((e: unknown) => e);
    expect(classifyError(miguErr).status).toBe('unsupported');

    const neErr = await defaultHomeSource
      .dailySongs({ source: 'netease', cookie: '', pacmToken: '' })
      .catch((e: unknown) => e);
    expect(classifyError(neErr).status).toBe('login-required');
  });
});

describe('home store: 发现页（榜单）', () => {
  it('loadDiscover 同时拉网易云榜单与咪咕榜单索引', async () => {
    const store = useHomeStore();
    store.configure(okSource());
    await store.loadDiscover();

    expect(store.toplists.status).toBe('ready');
    expect(store.toplists.items).toHaveLength(2);
    expect(store.miguRanks.status).toBe('ready');
    expect(store.miguRanks.items[0].style).toBe('咪咕特色榜');
    expect(store.miguRanks.items[0].ranks).toHaveLength(1);
  });

  it('一个来源挂了另一个仍可用', async () => {
    const store = useHomeStore();
    store.configure({
      ...okSource(),
      miguRanks: async () => {
        throw new Error('咪咕超时');
      },
    });
    await store.loadDiscover();
    expect(store.toplists.status).toBe('ready');
    expect(store.miguRanks.status).toBe('error');
    expect(store.miguRanks.error).toContain('咪咕超时');
  });
});

describe('home store: 最近播放', () => {
  it('从 config 读，最多 12 条', () => {
    const store = useHomeStore();
    configState.recent = Array.from({ length: 20 }, (_, i) => song(i));
    expect(store.recent).toHaveLength(12);
    expect(store.recent[0].id).toBe(0);
  });

  it('没有播放记录时为空数组（首页渲染空态）', () => {
    const store = useHomeStore();
    configState.recent = [];
    expect(store.recent).toEqual([]);
  });
});