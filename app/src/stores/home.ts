/**
 * 首页 / 发现 store（S5）。
 *
 * 设计要点（都是踩过的坑换来的）：
 *
 * 1. **每个区块独立三态**。首页一次要打 5 个接口，任何一个失败都不能把整页变成
 *    一片空白 —— 推荐歌单挂了不该顺带拖死最近播放。所以每个区块自己持有
 *    { status, items, error }，互不覆盖。
 *
 * 2. **"需要登录"不是错误**。网易云 /recommend/songs 无 cookie 直接抛业务错误，
 *    咪咕 getTodayRecommend 需要 pacmToken（实测恒回 200205）。这两种是已知的
 *    接口限制（见 docs/S2遗留与S3交接.md 1.3），必须显示成"请先登录"这类
 *    可解释的状态，而不是红字报错或空白页。
 *
 * 3. **数据获取可注入**。默认走真实 repository；测试用 configure() 换成假实现，
 *    这样"接口失败时降级"能被真的断言，而不是靠 mock 网络。
 */
import { defineStore } from 'pinia';
import { computed, ref, watch, type Ref } from 'vue';
import type { Song, SongSource } from '../data/normalize';
import { NeteaseRepository } from '../data/repository/netease';
import { migu, netease } from '../data/repository/index';
import type { HotWord, MiguRankGroup, RecommendPlaylist, ToplistItem } from '../data/repository/types';
import { useConfigStore } from './config';

/** 区块状态。login-required / unsupported 是"接口限制"而不是失败。 */
export type SectionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'login-required'
  | 'unsupported';

export interface Section<T> {
  status: SectionStatus;
  items: T[];
  /** 人话错误/原因；ready/empty 时为空串 */
  error: string;
}

function blank<T>(): Section<T> {
  return { status: 'idle', items: [], error: '' };
}

/** 未登录 / 无凭据 —— 与真正的网络错误区分开，UI 与降级策略都不同 */
export class LoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

/** 已实现但服务端不可用（例如咪咕每日推荐恒 200205），如实暴露而不是假装成功 */
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export interface DailyInput {
  source: SongSource;
  /** 网易云 cookie；空串表示未登录 */
  cookie: string;
  /** 咪咕 pacmToken；当前配置层还没有这个字段，恒为空串 */
  pacmToken: string;
}

/** 首页数据来源：默认实现打真接口，测试替换成可控假实现 */
export interface HomeDataSource {
  recommendPlaylists(source: SongSource, limit: number): Promise<RecommendPlaylist[]>;
  newSongs(limit: number): Promise<Song[]>;
  dailySongs(input: DailyInput): Promise<Song[]>;
  toplists(): Promise<ToplistItem[]>;
  miguRanks(): Promise<MiguRankGroup[]>;
  hotWords(source: SongSource, limit: number): Promise<HotWord[]>;
}

/**
 * 默认数据源。
 *
 * 网易云每日推荐要 cookie，而共享单例 netease 没有注入 cookie 的通道
 * （getCookie 只在构造时可传），所以这里按需构造一个带 cookie 的实例 ——
 * 不去改共享单例的隐性状态，也不会影响其它页面已通过的请求。
 */
export const defaultHomeSource: HomeDataSource = {
  async recommendPlaylists(source, limit) {
    return source === 'migu' ? migu.recommendPlaylists() : netease.personalized(limit);
  },
  async newSongs(limit) {
    return netease.personalizedNewsong(limit);
  },
  async dailySongs({ source, cookie, pacmToken }) {
    if (source === 'migu') {
      // 已知限制：需要 pacmToken 手机号/IMEI 登录态，无凭据时服务端恒返回 200205
      if (!pacmToken) {
        throw new UnsupportedError('咪咕每日推荐需要 pacmToken 登录态（当前接口恒返回 200205），暂不可用');
      }
      return migu.todayRecommendSongs(pacmToken);
    }
    if (!cookie) throw new LoginRequiredError('网易云每日推荐需要登录后使用');
    return new NeteaseRepository({ getCookie: () => cookie }).recommendSongs();
  },
  async toplists() {
    return netease.toplist();
  },
  async miguRanks() {
    return migu.rankIndex();
  },
  async hotWords(source, limit) {
    const words = source === 'migu' ? await migu.searchHot() : await netease.searchHotDetail(limit);
    return words.slice(0, limit);
  },
};

/** 把任意异常翻译成区块状态：接口限制优先于通用错误 */
export function classifyError(err: unknown): { status: SectionStatus; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof LoginRequiredError || /需要登录|需要 cookie|无 cookie/i.test(message)) {
    return { status: 'login-required', error: message };
  }
  if (err instanceof UnsupportedError || /200205/.test(message)) {
    return { status: 'unsupported', error: message };
  }
  return { status: 'error', error: message };
}

export const useHomeStore = defineStore('home', () => {
  const config = useConfigStore();

  const recommend = ref<Section<RecommendPlaylist>>(blank<RecommendPlaylist>());
  const newSongs = ref<Section<Song>>(blank<Song>());
  const daily = ref<Section<Song>>(blank<Song>());
  const toplists = ref<Section<ToplistItem>>(blank<ToplistItem>());
  const miguRanks = ref<Section<MiguRankGroup>>(blank<MiguRankGroup>());
  const hot = ref<Section<HotWord>>(blank<HotWord>());

  /** 数据源可替换（测试 / 未来换实现）；默认是真接口 */
  let source: HomeDataSource = defaultHomeSource;

  function configure(patch: Partial<HomeDataSource>): void {
    source = { ...source, ...patch };
  }

  function resetSource(): void {
    source = defaultHomeSource;
  }

  const sourceOf = computed<SongSource>(() => config.source);
  const loggedIn = computed(() => config.cookie !== '');

  /** 通用装载：统一处理 loading -> ready/empty/error（含接口限制状态） */
  async function fill<T>(
    target: Ref<Section<T>>,
    run: () => Promise<T[]>,
    unsupportedReason = '',
  ): Promise<void> {
    if (unsupportedReason) {
      target.value = { status: 'unsupported', items: [], error: unsupportedReason };
      return;
    }
    target.value = { status: 'loading', items: [], error: '' };
    try {
      const items = await run();
      target.value = { status: items.length > 0 ? 'ready' : 'empty', items, error: '' };
    } catch (err) {
      const picked = classifyError(err);
      target.value = { status: picked.status, items: [], error: picked.error };
    }
  }

  async function loadRecommend(force = false): Promise<void> {
    if (!force && (recommend.value.status === 'ready' || recommend.value.status === 'loading')) return;
    await fill(recommend, () => source.recommendPlaylists(sourceOf.value, 10));
  }

  async function loadNewSongs(force = false): Promise<void> {
    if (!force && (newSongs.value.status === 'ready' || newSongs.value.status === 'loading')) return;
    await fill(newSongs, () => source.newSongs(12));
  }

  /**
   * 每日推荐：是否"需要登录"由数据源判定（netease 的 recommendSongs 在 !cookie 时直接抛，
   * 不发 HTTP；咪咕恒 unsupported）—— store 只做状态归类，不越权替音源下结论。
   */
  async function loadDaily(force = false): Promise<void> {
    if (!force && (daily.value.status === 'ready' || daily.value.status === 'loading')) return;
    // 已在请求中就不再并发第二发：force 是给"失败之后重试"用的，不是给登录态连翻两次用的
    if (daily.value.status === 'loading') return;
    const input: DailyInput = {
      source: sourceOf.value,
      cookie: config.cookie,
      // 配置层还没有 pacmToken 字段（见报告"所需配置字段"），这里恒为空串，
      // 于是咪咕分支必然落 unsupported —— 这是如实反映，不是漏做。
      pacmToken: '',
    };
    daily.value = { status: 'loading', items: [], error: '' };
    try {
      const items = await source.dailySongs(input);
      daily.value = { status: items.length > 0 ? 'ready' : 'empty', items, error: '' };
    } catch (err) {
      const picked = classifyError(err);
      daily.value = { status: picked.status, items: [], error: picked.error };
    }
  }

  /**
   * 登录态就绪通常**晚于**首页首拉：config 要从磁盘异步装载，扫码登录更是运行中途才写入。
   * 少了这个 watch，已登录用户会一直看到"每日推荐需要登录"（实测 exe 里就卡在这个状态）。
   * 反向也要成立：退出登录后不能继续显示上一次的推荐曲目。
   */
  watch(loggedIn, (now, prev) => {
    if (now && !prev) void loadDaily(true);
    else if (!now && prev) daily.value = { status: 'login-required', items: [], error: '网易云每日推荐需要登录后使用' };
  });

  async function loadToplists(force = false): Promise<void> {
    if (!force && (toplists.value.status === 'ready' || toplists.value.status === 'loading')) return;
    await fill(toplists, () => source.toplists());
  }

  async function loadMiguRanks(force = false): Promise<void> {
    if (!force && (miguRanks.value.status === 'ready' || miguRanks.value.status === 'loading')) return;
    await fill(miguRanks, () => source.miguRanks());
  }

  async function loadHot(force = false): Promise<void> {
    if (!force && (hot.value.status === 'ready' || hot.value.status === 'loading')) return;
    await fill(hot, () => source.hotWords(sourceOf.value, 10));
  }

  /** 首页一次拉满：五个请求并发，任一失败只影响自己那一块 */
  async function loadHome(): Promise<void> {
    await Promise.all([loadRecommend(), loadNewSongs(), loadDaily(), loadHot()]);
  }

  /** 排行榜页（DiscoverView）用：网易云 + 咪咕索引 */
  async function loadDiscover(): Promise<void> {
    await Promise.all([loadToplists(), loadMiguRanks()]);
  }

  const recent = computed<Song[]>(() => config.recent.slice(0, 12));

  return {
    recommend,
    newSongs,
    daily,
    toplists,
    miguRanks,
    hot,
    recent,
    loggedIn,
    sourceOf,
    configure,
    resetSource,
    loadRecommend,
    loadNewSongs,
    loadDaily,
    loadToplists,
    loadMiguRanks,
    loadHot,
    loadHome,
    loadDiscover,
  };
});
