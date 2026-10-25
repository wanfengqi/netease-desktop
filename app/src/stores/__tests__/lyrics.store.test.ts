import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useLyricsStore } from '../lyrics';
import type { NextConfig } from '../../data/config';
import type { Song } from '../../data/normalize';

/**
 * 歌词 store 的行为测试（S4）。
 *
 * 覆盖三件在真实运行里容易出错、但纯看代码很难确认的事：
 *  1. 偏移写盘走 config.update（唯一落盘通道），且夹到 ±10s；
 *  2. 切歌 token：后发请求胜出，过期响应不落地；
 *  3. snapshot() 推给桌面歌词窗的时间轴**已经折算偏移**（两个窗口各算一遍必然漂）。
 */

/** 造一首最小的 Song（剩余字段与仓库层无关，测试里不需要） */
function song(over: Partial<Song> & { source: 'netease' | 'migu' }): Song {
  return {
    id: 1,
    name: 'n',
    artistText: '',
    artists: [],
    album: { name: '' },
    duration: 0,
    ...over,
  } as Song;
}

const BASE_CONFIG: NextConfig = {
  version: 1,
  source: 'netease',
  playMode: 'list',
  volume: 0.8,
  muted: true,
  lyricOffset: 0,
  equalizer: { enabled: false, bands: [] },
  favorites: [],
  recent: [],
  queue: [],
  queueIndex: -1,
  searchHistory: [],
  cookie: '',
  windowBounds: null,
  extra: {},
  migratedFrom: '',
  updatedAt: 0,
};

let saved: Partial<NextConfig>[] = [];

function installFakeBridge(initial: Partial<NextConfig> = {}): void {
  const config = { ...BASE_CONFIG, ...initial };
  const api = {
    config: {
      load: async () => config,
      save: async (patch: Partial<NextConfig>) => {
        saved.push(patch);
        return { ...config, ...patch };
      },
    },
  };
  (globalThis as unknown as { window?: unknown }).window = { api };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  saved = [];
  vi.restoreAllMocks();
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('歌词 store - 偏移', () => {
  it('config 先加载好时，初值直接来自 config.lyricOffset', async () => {
    installFakeBridge({ lyricOffset: 4.5 });
    const { useConfigStore } = await import('../config');
    await useConfigStore().load();
    const store = useLyricsStore();
    expect(store.offset).toBe(4.5);
  });

  it('config 后加载时（真实启动顺序）也能补上偏移', async () => {
    installFakeBridge({ lyricOffset: -3.5 });
    const { useConfigStore } = await import('../config');
    const config = useConfigStore();
    // store 先建、config 后 load —— 这条路径靠 watch 兜住
    const store = useLyricsStore();
    expect(store.offset).toBe(0);
    await config.load();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.offset).toBe(-3.5);
  });

  it('超过 ±10s 的初值被夹住', async () => {
    installFakeBridge({ lyricOffset: 99 });
    const { useConfigStore } = await import('../config');
    await useConfigStore().load();
    const store = useLyricsStore();
    expect(store.offset).toBe(10);
  });

  it('nudge 每次 0.5s，并同步 offsetLabel', () => {
    installFakeBridge();
    const store = useLyricsStore();
    store.nudgeOffset(0.5);
    store.nudgeOffset(0.5);
    expect(store.offset).toBe(1);
    expect(store.offsetLabel).toBe('+1.0s');
    store.nudgeOffset(-1.5);
    expect(store.offset).toBe(-0.5);
  });

  it('超出 ±10s 被夹住（旧版就是 ±10s）', () => {
    installFakeBridge();
    const store = useLyricsStore();
    for (let i = 0; i < 40; i += 1) store.nudgeOffset(0.5);
    expect(store.offset).toBe(10);
    for (let i = 0; i < 60; i += 1) store.nudgeOffset(-0.5);
    expect(store.offset).toBe(-10);
  });

  it('写盘走 config.update（防抖后落到 save）', async () => {
    installFakeBridge();
    const store = useLyricsStore();
    store.setOffset(2.5);
    await new Promise((r) => setTimeout(r, 600));
    expect(saved.some((patch) => patch.lyricOffset === 2.5)).toBe(true);
  });

  it('resetOffset 归零', () => {
    installFakeBridge();
    const store = useLyricsStore();
    store.setOffset(3);
    store.resetOffset();
    expect(store.offset).toBe(0);
  });
});

describe('歌词 store - 取歌词与切歌竞态', () => {
  it('网易云走 netease.lyric，咪咕走 migu.lyric（含 lrcUrl 兜底后的结果）', async () => {
    installFakeBridge();
    const store = useLyricsStore();
    const neteaseLyric = vi
      .spyOn(await import('../../data/repository/index'), 'netease', 'get')
      .mockReturnValue({
        lyric: async () => ({ lyric: '[00:01.00]netease 行', translation: '' }),
      } as never);
    await store.load(song({ source: 'netease', id: 1 }));
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0].text).toBe('netease 行');
    neteaseLyric.mockRestore();
  });

  it('空歌词时 isEmpty=true（组件据此显示明确空态）', async () => {
    installFakeBridge();
    const store = useLyricsStore();
    const miguLyric = vi
      .spyOn(await import('../../data/repository/index'), 'migu', 'get')
      .mockReturnValue({ lyric: async () => ({ lyric: '', translation: '' }) } as never);
    await store.load(song({ source: 'migu', id: 'x', contentId: 'x' }));
    expect(store.isEmpty).toBe(true);
    expect(store.hasLyrics).toBe(false);
    miguLyric.mockRestore();
  });

  it('取歌词抛错时 error 有值且不算有歌词', async () => {
    installFakeBridge();
    const store = useLyricsStore();
    const miguLyric = vi
      .spyOn(await import('../../data/repository/index'), 'migu', 'get')
      .mockReturnValue({
        lyric: async () => {
          throw new Error('网络断了');
        },
      } as never);
    await store.load(song({ source: 'migu', id: 'x', contentId: 'x' }));
    expect(store.error).toContain('网络断了');
    expect(store.hasLyrics).toBe(false);
    miguLyric.mockRestore();
  });

  it('后发请求胜出：先发的慢响应不覆盖后发的', async () => {
    installFakeBridge();
    const store = useLyricsStore();
    let resolveSlow: (v: { lyric: string; translation: string }) => void = () => undefined;
    const slow = new Promise<{ lyric: string; translation: string }>((resolve) => {
      resolveSlow = resolve;
    });
    let call = 0;
    const neteaseGet = vi.spyOn(await import('../../data/repository/index'), 'netease', 'get');
    neteaseGet.mockReturnValue({
      lyric: async () => {
        call += 1;
        if (call === 1) return slow;
        return { lyric: '[00:01.00]第二首', translation: '' };
      },
    } as never);

    const songA = song({ source: 'netease', id: 1, name: 'A' });
    const songB = song({ source: 'netease', id: 2, name: 'B' });
    const first = store.load(songA);
    await store.load(songB);
    resolveSlow({ lyric: '[00:01.00]第一首', translation: '' });
    await first;

    expect(store.lines).toHaveLength(1);
    expect(store.lines[0].text).toBe('第二首');
    neteaseGet.mockRestore();
  });

  it('load(null) 清空歌词与标题', async () => {
    installFakeBridge();
    const store = useLyricsStore();
    await store.load(null);
    expect(store.lines).toHaveLength(0);
    expect(store.songTitle).toBe('');
    expect(store.isEmpty).toBe(true);
  });
});

describe('歌词 store - 下标与桌面快照', () => {
  async function loadLines(): Promise<ReturnType<typeof useLyricsStore>> {
    installFakeBridge();
    const store = useLyricsStore();
    const get = vi.spyOn(await import('../../data/repository/index'), 'netease', 'get');
    get.mockReturnValue({
      lyric: async () => ({
        lyric: '[00:10.00]a\n[00:20.00]b\n[00:30.00]c',
        translation: '',
      }),
    } as never);
    await store.load(song({ source: 'netease', id: 1 }));
    get.mockRestore();
    return store;
  }

  it('indexAt 按当前偏移算当前行', async () => {
    const store = await loadLines();
    expect(store.indexAt(15)).toBe(0);
    // offset=+5：比较用时间 = 进度 - 5，15s 落在原始 10s 这一行
    store.setOffset(5);
    expect(store.indexAt(15)).toBe(0);
    expect(store.indexAt(25)).toBe(1);
    expect(store.indexAt(35)).toBe(2);
    // offset=-5：比较用时间 = 进度 + 5，15s 落在原始 20s 这一行
    store.setOffset(-5);
    expect(store.indexAt(15)).toBe(1);
  });

  it('seekTargetFor 返回原始时间 + 偏移（点歌词跳转用）', async () => {
    const store = await loadLines();
    expect(store.seekTargetFor(1)).toBe(20);
    store.setOffset(2.5);
    expect(store.seekTargetFor(1)).toBe(22.5);
    expect(store.seekTargetFor(99)).toBe(0);
  });

  it('snapshot 里推给桌面歌词窗的 time 已折算偏移', async () => {
    const store = await loadLines();
    store.setOffset(3);
    const snap = store.snapshot('歌', '人');
    expect(snap.lines.map((line) => line.time)).toEqual([13, 23, 33]);
    expect(snap.lines.map((line) => line.text)).toEqual(['a', 'b', 'c']);
    expect(snap.title).toBe('歌');
    expect(snap.offset).toBe(3);
  });

  it('snapshot 的 time 与 indexAt 自洽（两边算法一致才不会漂）', async () => {
    const store = await loadLines();
    for (const offset of [-4, -1.5, 0, 2, 6]) {
      store.setOffset(offset);
      const snap = store.snapshot('', '');
      for (const t of [0, 9, 12, 21, 33]) {
        let lo = 0;
        let hi = snap.lines.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (snap.lines[mid].time <= t) {
            found = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        expect(found).toBe(store.indexAt(t));
      }
    }
  });
});