import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, type AudioElementLike, type AudioEventName } from '../audio';
import { Player, classifyMediaError, indexOfKey, type PersistedPlayerState } from '../player';
import type { Song } from '../../data/normalize';

/** 可控的 audio 替身：src 可读、事件可手工触发、paused 随 play/pause 变化。 */
function fakeElement() {
  const handlers = new Map<string, Set<() => void>>();
  let srcValue = '';
  const el = {
    get src() {
      return srcValue;
    },
    set src(v: string) {
      srcValue = v;
    },
    volume: 0.8,
    muted: false,
    currentTime: 0,
    duration: 180,
    paused: true,
    crossOrigin: null as string | null,
    error: null as { code: number } | null,
    buffered: { length: 0, end: () => 0 },
    play: vi.fn(() => {
      (el as unknown as { paused: boolean }).paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      (el as unknown as { paused: boolean }).paused = true;
    }),
    addEventListener(type: string, fn: () => void) {
      const set = handlers.get(type) ?? new Set();
      set.add(fn);
      handlers.set(type, set);
    },
    removeEventListener(type: string, fn: () => void) {
      handlers.get(type)?.delete(fn);
    },
    removeAttribute: vi.fn(),
  } as unknown as AudioElementLike & Record<string, unknown>;

  return {
    el,
    fire(type: AudioEventName) {
      handlers.get(type)?.forEach((fn) => fn());
    },
  };
}

function song(id: number, name: string, source: Song['source'] = 'netease'): Song {
  return {
    id,
    source,
    name,
    artistText: '周杰伦',
    artists: [{ name: '周杰伦' }],
    album: { name: '叶惠美' },
    duration: 269000,
  };
}

const A = song(1, '以父之名');
const B = song(2, '懦夫');
const C = song(3, '晴天');

const OK_URL = async () => ({ url: 'http://x/ok.mp3' });

/** 造一个"能取到地址"的播放器 */
function makePlayer(options: { toasts?: string[]; rng?: () => number } = {}) {
  const { el, fire } = fakeElement();
  const engine = new AudioEngine({ element: el, initialVolume: 0.8 });
  const toasts = options.toasts ?? [];
  const player = new Player({
    engine,
    onToast: (m) => toasts.push(m),
    resolveTimeoutMs: 0,
    rng: options.rng ?? (() => 0.99),
    fetchUrl: OK_URL,
  });
  return { el, fire, engine, player, toasts };
}

describe('Player — playAt 竞态（修旧 2.1「点 B 放 A」）', () => {
  /** 第 1 次取址慢（60ms 才回 A 的地址），第 2 次快（立刻回 B 的地址） */
  function racyPlayer() {
    const el = fakeElement();
    const engine = new AudioEngine({ element: el.el });
    let call = 0;
    const player = new Player({
      engine,
      resolveTimeoutMs: 0,
      fetchUrl: () => {
        call += 1;
        if (call === 1) {
          return new Promise((r) => setTimeout(() => r({ url: 'http://x/A.mp3' }), 60));
        }
        return Promise.resolve({ url: 'http://x/B.mp3' });
      },
    });
    player.setQueue([A, B]);
    return { el: el.el, engine, player };
  }

  it('先发的慢响应回来后已过期：元素里只会是后发那首的 url', async () => {
    const { el, engine, player } = racyPlayer();

    const first = player.playAt(0); // 慢
    const second = player.playAt(1); // 快
    await Promise.all([first, second]);

    expect(engine.element.src).toBe('http://x/B.mp3');
    expect(el.src).not.toBe('http://x/A.mp3');
    expect(player.currentIndex).toBe(1);
    expect(player.snapshot.song?.name).toBe('懦夫');
  });

  it('过期响应静默丢弃：不 toast、不写 lastError', async () => {
    const el = fakeElement();
    const engine = new AudioEngine({ element: el.el });
    const toasts: string[] = [];
    let call = 0;
    const player = new Player({
      engine,
      onToast: (m) => toasts.push(m),
      resolveTimeoutMs: 0,
      fetchUrl: () => {
        call += 1;
        if (call === 1) {
          return new Promise((r) => setTimeout(() => r({ url: null, reason: '无版权 / 需要 VIP' }), 40));
        }
        return Promise.resolve({ url: 'http://x/B.mp3' });
      },
    });
    player.setQueue([A, B]);
    await Promise.all([player.playAt(0), player.playAt(1)]);

    expect(toasts).toEqual([]);
    expect(player.snapshot.lastError).toBeNull();
    expect(el.el.src).toBe('http://x/B.mp3');
  });
});

describe('Player — prev 无条件优先吃历史栈（旧 1.3）', () => {
  it('列表循环模式下也优先回到"上次从哪跳过来"，而不是 index-1', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('list');

    await player.playAt(0); // 历史 []
    await player.playAt(2); // 历史 [0]
    await player.playAt(1); // 历史 [0, 2]
    expect(player.currentIndex).toBe(1);

    await player.prev();
    expect(player.currentIndex).toBe(2); // 栈顶 2，不是 index-1 = 0

    await player.prev();
    expect(player.currentIndex).toBe(0); // 再弹一层
  });

  it('历史栈空了才退到 pickPrevIndex（单曲队列时回到自己）', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('list');
    await player.playAt(1); // 历史 []
    await player.prev(); // 栈空 → (1-1+3)%3 = 0
    expect(player.currentIndex).toBe(0);
  });

  it('历史栈里的过期索引被丢弃（对应曲目已不存在）', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    await player.playAt(0); // 历史 []
    await player.playAt(2); // 历史 [0]
    // 剩下 2 首：把索引 0/1 之外的历史项全部变成越界
    await player.removeAt(1); // 删 B，剩 [A, C]，当前曲 2→1（C）
    await player.removeAt(0); // 删 A，剩 [C]，当前曲 1→0
    expect(player.currentIndex).toBe(0);
    await player.prev(); // 历史里只有越界索引 → 退回 pickPrevIndex
    expect(player.currentIndex).toBe(0);
  });
});

describe('Player — next 的 auto / manual 差异（旧 1.1 / 1.2）', () => {
  it('order 模式手动 next 在末尾回绕到 0', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('order');
    await player.playAt(2);
    await player.next(false);
    expect(player.currentIndex).toBe(0);
  });

  it('order 模式 auto next 在末尾停止（保留当前曲目、暂停）', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('order');
    await player.playAt(2);
    await player.next(true);
    expect(player.currentIndex).toBe(2);
    expect(player.snapshot.playing).toBe(false);
  });

  it('one 模式手动 next 真的走到下一首', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('one');
    await player.playAt(0);
    await player.next(false);
    expect(player.currentIndex).toBe(1);
  });

  it('one 模式 auto next 重复当前曲', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('one');
    await player.playAt(0);
    await player.next(true);
    expect(player.currentIndex).toBe(0);
  });

  it('ended 事件走的是 auto 分支（order 到末尾即停，不回绕）', async () => {
    const { player, fire } = makePlayer();
    player.setQueue([A, B, C]);
    player.setMode('order');
    await player.playAt(2);
    fire('ended');
    await new Promise((r) => setTimeout(r, 10));
    expect(player.currentIndex).toBe(2);
  });
});

describe('Player — 持久化用 key 恢复（修旧 2.6）', () => {
  it('队列顺序变了，仍能定位到原来那首歌', () => {
    const saved: PersistedPlayerState = {
      songs: [C, A, B], // 落盘后顺序变了
      currentKey: 'netease:1', // 原本是 A
      mode: 'shuffle',
      volume: 0.5,
      muted: false,
    };
    const { player, el } = makePlayer();
    const located = player.restore(saved);

    expect(located).toBe(true);
    expect(player.currentIndex).toBe(1); // A 在新顺序里的位置，而不是落盘时的 0
    expect(player.currentSong?.name).toBe('以父之名');
    expect(player.playMode).toBe('shuffle');
    expect(el.volume).toBe(0.5);
  });

  it('key 找不到时返回 false 且 index=-1（绝不硬套索引）', () => {
    const { player } = makePlayer();
    const located = player.restore({
      songs: [B, C],
      currentKey: 'netease:999',
      mode: 'list',
      volume: 0.8,
      muted: false,
    });
    expect(located).toBe(false);
    expect(player.currentIndex).toBe(-1);
    expect(player.currentSong).toBeNull();
  });

  it('persist() 记下当前曲的 key（存 key 不存索引）', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    await player.playAt(1);
    const snapshot = player.persist();
    expect(snapshot.currentKey).toBe('netease:2');
    expect(snapshot.songs).toHaveLength(3);
    expect(Object.keys(snapshot)).not.toContain('index');
  });

  it('indexOfKey 跨源不串味（同 id 不同 source 认成两首）', () => {
    const mg = song(1, '以父之名', 'migu');
    const list = [A, mg];
    expect(indexOfKey(list, 'netease:1')).toBe(0);
    expect(indexOfKey(list, 'migu:1')).toBe(1);
    expect(indexOfKey(list, '')).toBe(-1);
  });
});

describe('Player — 取址为空必须提示，不静默失败', () => {
  it('无版权 / VIP 时 toast 且不写元素 src', async () => {
    const el = fakeElement();
    const engine = new AudioEngine({ element: el.el });
    const toasts: string[] = [];
    const player = new Player({
      engine,
      onToast: (m) => toasts.push(m),
      fetchUrl: async () => ({ url: null, reason: '无版权 / 需要 VIP' }),
    });
    player.setQueue([A]);
    await player.playAt(0);

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('无版权');
    expect(el.el.src).toBe('');
    expect(player.snapshot.lastError?.kind).toBe('no-url');
  });

  it('clearQueue 一并清历史栈（旧 2.2）', async () => {
    const { player } = makePlayer();
    player.setQueue([A, B, C]);
    await player.playAt(0);
    await player.playAt(1);
    expect(player.snapshot.queue.history).toEqual([0]);

    player.clearQueue();
    expect(player.snapshot.queue.items).toEqual([]);
    expect(player.snapshot.queue.history).toEqual([]);
    expect(player.currentIndex).toBe(-1);
  });
});

describe('Player — media error 成因区分（旧 2.4）', () => {
  it('classifyMediaError 把 code 4 归为"地址不可用"，不归 CORS', () => {
    expect(classifyMediaError(4)?.kind).toBe('unsupported');
    expect(classifyMediaError(2)?.kind).toBe('network');
    expect(classifyMediaError(3)?.kind).toBe('decode');
    expect(classifyMediaError(1)?.kind).toBe('aborted');
    expect(classifyMediaError(0)).toBeNull();
  });

  it('真坏 url（无 crossOrigin 残留）只报一次错，不无限重播', async () => {
    const { player, el, fire, toasts } = makePlayer();
    player.setQueue([A]);
    await player.playAt(0);
    const playCallsAfterLoad = (el.play as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    (el as unknown as { error: { code: number } | null }).error = { code: 4 };
    fire('error');
    await new Promise((r) => setTimeout(r, 10));

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('地址不可用');
    expect(player.snapshot.lastError?.kind).toBe('unsupported');
    expect((el.play as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      playCallsAfterLoad,
    );
  });
});
