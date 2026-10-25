import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  defaultCrossOriginPolicy,
  isPlayAbortError,
  type AudioElementLike,
  type AudioEventName,
} from '../audio';
import type { Song } from '../../data/normalize';

function song(source: Song['source'] = 'netease'): Song {
  return {
    id: 1,
    source,
    name: 'n',
    artistText: 'a',
    artists: [{ name: 'a' }],
    album: { name: 'al' },
    duration: 1000,
  };
}

/** 手写替身：记录属性写入顺序，用来断言 crossOrigin 先于 src。 */
function fakeElement(overrides: Partial<AudioElementLike> = {}) {
  const writes: string[] = [];
  const handlers = new Map<string, Set<() => void>>();
  let srcValue = '';
  const el = {
    get src() {
      return srcValue;
    },
    set src(v: string) {
      writes.push('src');
      srcValue = v;
    },
    volume: 0.7, // 下面替换成会记录写入的访问器
    muted: false,
    currentTime: 0,
    duration: 200,
    paused: true,
    crossOrigin: null as string | null,
    error: null,
    buffered: { length: 0, end: () => 0 },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener(type: string, fn: () => void) {
      const set = handlers.get(type) ?? new Set();
      set.add(fn);
      handlers.set(type, set);
    },
    removeEventListener(type: string, fn: () => void) {
      handlers.get(type)?.delete(fn);
    },
    removeAttribute: vi.fn(),
    ...overrides,
  } as AudioElementLike & Record<string, unknown>;

  Object.defineProperty(el, 'volume', {
    get: () => (el as unknown as { __vol: number }).__vol,
    set: (v: number) => {
      writes.push('volume');
      (el as unknown as { __vol: number }).__vol = v;
    },
    configurable: true,
  });
  (el as unknown as { __vol: number }).__vol = 0.7;

  Object.defineProperty(el, 'crossOrigin', {
    get: () => (el as unknown as { __co: string | null }).__co ?? null,
    set: (v: string | null) => {
      writes.push('crossOrigin');
      (el as unknown as { __co: string | null }).__co = v;
    },
    configurable: true,
  });

  return {
    el,
    writes,
    fire(type: AudioEventName) {
      handlers.get(type)?.forEach((fn) => fn());
    },
  };
}

describe('AudioEngine — 播放前顺序契约', () => {
  it('load() 的写入顺序是 crossOrigin → src → volume → play', async () => {
    const { el, writes } = fakeElement();
    const engine = new AudioEngine({ element: el, initialVolume: 0.4 });
    writes.length = 0; // 忽略构造期的初始化写入，只断言 load() 的顺序

    await engine.load(song('netease'), 'http://x/a.mp3');

    expect(writes).toEqual(['crossOrigin', 'src', 'volume']);
    expect(el.crossOrigin).toBe('anonymous');
    expect(el.volume).toBe(0.4);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('咪咕源在设 src 前把 crossOrigin 清成 null（否则 Web Audio 哑音）', async () => {
    const { el, writes } = fakeElement();
    const engine = new AudioEngine({ element: el });
    writes.length = 0;

    await engine.load(song('migu'), 'http://mg/b.mp3');

    expect(writes.indexOf('crossOrigin')).toBeLessThan(writes.indexOf('src'));
    expect(el.crossOrigin).toBeNull();
    expect(el.removeAttribute).toHaveBeenCalledWith('crossorigin');
  });

  it('crossOriginPolicy 可注入，替换默认策略', async () => {
    const { el } = fakeElement();
    const engine = new AudioEngine({ element: el, crossOriginPolicy: () => null });
    await engine.load(song('netease'), 'u');
    expect(el.crossOrigin).toBeNull();
    expect(defaultCrossOriginPolicy(song('netease'))).toBe('anonymous');
    expect(defaultCrossOriginPolicy(null)).toBeNull();
  });

  it('autoplay: false 时不调用 play', async () => {
    const { el } = fakeElement();
    const engine = new AudioEngine({ element: el });
    await engine.load(song(), 'u', { autoplay: false });
    expect(el.play).not.toHaveBeenCalled();
  });
});

describe('AudioEngine — 播放错误', () => {
  it('AbortError 被静默吞掉（快速切歌不是故障）', async () => {
    const abort = new Error('The play() request was interrupted by a new load request');
    abort.name = 'AbortError';
    const { el } = fakeElement({ play: vi.fn(() => Promise.reject(abort)) });
    const engine = new AudioEngine({ element: el });
    await expect(engine.load(song(), 'u')).resolves.toBeUndefined();
  });

  it('非 Abort 错误向上抛出，交给 UI 决定是否提示', async () => {
    const { el } = fakeElement({ play: vi.fn(() => Promise.reject(new Error('decode failed'))) });
    const engine = new AudioEngine({ element: el });
    await expect(engine.load(song(), 'u')).rejects.toThrow('decode failed');
  });

  it('isPlayAbortError 的类型守卫行为', () => {
    expect(isPlayAbortError(null)).toBe(true);
    expect(isPlayAbortError({ name: 'AbortError' })).toBe(true);
    expect(isPlayAbortError({ message: 'Interrupted by a new load' })).toBe(true);
    expect(isPlayAbortError(new Error('boom'))).toBe(false);
    expect(MEDIA_ERR_SRC_NOT_SUPPORTED).toBe(4);
  });
});

describe('AudioEngine — 进度与音量', () => {
  it('seekRatio 在时长无效时什么都不做（不是跳回 0）', () => {
    const { el } = fakeElement({ duration: Number.NaN });
    const engine = new AudioEngine({ element: el });
    el.currentTime = 12;
    engine.seekRatio(0.5);
    expect(el.currentTime).toBe(12);
  });

  it('seekRatio 与 seek 都会夹在 [0, duration]', () => {
    const { el } = fakeElement();
    const engine = new AudioEngine({ element: el });
    engine.seekRatio(0.5);
    expect(el.currentTime).toBe(100);
    engine.seek(999);
    expect(el.currentTime).toBe(200);
    engine.seek(-5);
    expect(el.currentTime).toBe(0);
  });

  it('setVolume 夹到 [0,1]，且从 0 拉起来时自动取消静音', () => {
    const { el } = fakeElement();
    const engine = new AudioEngine({ element: el, initialMuted: true });
    engine.setVolume(1.6);
    expect(el.volume).toBe(1);
    expect(el.muted).toBe(false); // 自动解除静音
    engine.setVolume(-1);
    expect(el.volume).toBe(0);
    expect(engine.currentVolume).toBe(0);
  });

  it('setMuted 只改静音，不动音量', () => {
    const { el } = fakeElement();
    const engine = new AudioEngine({ element: el, initialVolume: 0.3 });
    engine.setMuted(true);
    expect(el.muted).toBe(true);
    expect(el.volume).toBe(0.3);
    expect(engine.isMuted).toBe(true);
  });
});

describe('AudioEngine — 事件订阅', () => {
  it('subscribe 收到快照并可退订', () => {
    const { el, fire } = fakeElement();
    const engine = new AudioEngine({ element: el });
    const seen: number[] = [];
    const off = engine.subscribe('timeupdate', (s) => seen.push(s.currentTime));

    el.currentTime = 42;
    fire('timeupdate');
    expect(seen).toEqual([42]);

    off();
    el.currentTime = 43;
    fire('timeupdate');
    expect(seen).toEqual([42]);
  });

  it('subscribeAll 覆盖全部事件，dispose 后清空', () => {
    const { el, fire } = fakeElement();
    const engine = new AudioEngine({ element: el });
    let count = 0;
    const off = engine.subscribeAll(() => {
      count += 1;
    });
    fire('play');
    fire('pause');
    expect(count).toBe(2);
    off();
    fire('play');
    expect(count).toBe(2);

    engine.dispose();
    expect(() => fire('play')).not.toThrow();
  });

  it('snapshot 把无效时长归零（isFinite 守卫）', () => {
    const { el } = fakeElement({ duration: Number.POSITIVE_INFINITY });
    const engine = new AudioEngine({ element: el });
    expect(engine.snapshot.duration).toBe(0);
    expect(engine.snapshot.hasSource).toBe(false);
  });
});
