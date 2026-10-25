import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, type AudioElementLike, type AudioEventName } from '../audio';
import { Player } from '../player';
import type { Song } from '../../data/normalize';

/**
 * 上一首 / 下一首的**历史栈语义**（旧 1.3 + 2.2）。
 *
 * 这组用例对应端到端实测里观察到的一条容易误判的现象：
 *   next 三首后连按三次 prev，轨迹是 next 的**逆序**，
 *   但每次 prev 的目标是"上一次的位置"，不含当前位置。
 *   history=[0,1,2]（当前 3）时：prev->2(hist[0,1])，prev->1(hist[0])，prev->0(hist[])。
 */
function fakeElement() {
  const handlers = new Map<string, Set<() => void>>();
  let src = '';
  const el = {
    get src() { return src; },
    set src(v: string) { src = v; },
    volume: 1,
    muted: true,
    currentTime: 0,
    duration: 200,
    paused: true,
    crossOrigin: null as string | null,
    error: null,
    buffered: { length: 0, end: () => 0 },
    play: vi.fn(() => { (el as unknown as { paused: boolean }).paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { (el as unknown as { paused: boolean }).paused = true; }),
    addEventListener(type: string, fn: () => void) {
      const set = handlers.get(type) ?? new Set();
      set.add(fn);
      handlers.set(type, set);
    },
    removeEventListener(type: string, fn: () => void) { handlers.get(type)?.delete(fn); },
    removeAttribute: vi.fn(),
  } as unknown as AudioElementLike & Record<string, unknown>;
  return { el, fire: (t: AudioEventName) => handlers.get(t)?.forEach((fn) => fn()) };
}

function song(id: number, name: string): Song {
  return {
    id, source: 'netease', name, artistText: '周杰伦',
    artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, duration: 200000,
  };
}

const LIST = [0, 1, 2, 3, 4, 5].map((i) => song(i + 1, '曲目' + (i + 1)));

function makePlayer(mode: 'list' | 'one' | 'shuffle' | 'order' = 'list') {
  const { el } = fakeElement();
  const engine = new AudioEngine({ element: el, initialVolume: 0, initialMuted: true });
  const toasts: string[] = [];
  const player = new Player({
    engine,
    mode,
    onToast: (m) => toasts.push(m),
    resolveTimeoutMs: 0,
    rng: () => 0.99,
    fetchUrl: async () => ({ url: 'http://x/ok.mp3' }),
  });
  player.setQueue(LIST);
  return { player, el, toasts };
}

describe('Player — next/prev 的历史栈轨迹（旧 1.3）', () => {
  it('连按三次 next 后，三次 prev 逆序回放，最后回到起点', async () => {
    const { player } = makePlayer('list');
    await player.playAt(0); // 起点，历史 []

    const forward: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await player.next(false);
      forward.push(player.currentSong?.name ?? '');
    }
    // 0 -> 1 -> 2 -> 3
    expect(forward).toEqual(['曲目2', '曲目3', '曲目4']);
    expect(player.snapshot.queue.history).toEqual([0, 1, 2]);

    const back: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await player.prev();
      back.push(player.currentSong?.name ?? '');
    }
    // 栈顶 2 -> 曲目3；再弹 1 -> 曲目2；再弹 0 -> 曲目1（起点）
    expect(back).toEqual(['曲目3', '曲目2', '曲目1']);
    expect(player.snapshot.queue.history).toEqual([]);
        // 端到端实测同款断言：prev 轨迹是 next 轨迹的逆序接起点
    expect(back).toEqual([...forward.slice(0, -1).reverse(), '曲目1']);
  });

  it('历史栈被弹空后，再 prev 才走 pickPrevIndex（index-1）', async () => {
    const { player } = makePlayer('list');
    await player.playAt(2); // 历史 []
    await player.next(false); // 3，历史 [2]
    await player.prev(); // 回 2，历史 []
    expect(player.currentSong?.name).toBe('曲目3');

    await player.prev(); // 栈空 -> (2-1+6)%6 = 1
    expect(player.currentSong?.name).toBe('曲目2');
  });

  it('playList 换列表会清历史栈（旧 setQueue 语义）', async () => {
    const { player } = makePlayer('list');
    await player.playAt(0);
    await player.next(false);
    expect(player.snapshot.queue.history).toHaveLength(1);

    await player.playList(LIST, 4);
    expect(player.snapshot.queue.history).toEqual([]);
    expect(player.currentIndex).toBe(4);
  });

  it('shuffle 模式下 prev 也先吃历史栈（与模式无关，旧 1.3）', async () => {
    const { player } = makePlayer('shuffle');
    await player.playAt(0); // 历史 []
    // rng 恒为 0.99 -> shuffle 选 floor(0.99*6)=5
    await player.next(false);
    expect(player.currentIndex).toBe(5);
    expect(player.snapshot.queue.history).toEqual([0]);

    await player.prev(); // 栈顶 0，不是"随机上一首"
    expect(player.currentIndex).toBe(0);
  });

  it('one 模式下 prev 依然优先历史栈（不是"重复当前曲"）', async () => {
    const { player } = makePlayer('one');
    await player.playAt(0);
    await player.next(false); // one + manual -> 1
    expect(player.currentIndex).toBe(1);
    await player.prev(); // 栈顶 0
    expect(player.currentIndex).toBe(0);
  });
});

describe('Player — 静音状态下播放仍推进（无头/静音验收用的判定依据）', () => {
  it('muted=true 时依然 load + play，paused 变 false', async () => {
    const { player, el } = makePlayer('list');
    expect(el.muted).toBe(true);
    await player.playAt(0);
    expect(el.paused).toBe(false);
    expect(el.src).toBe('http://x/ok.mp3');
    expect(player.snapshot.muted).toBe(true);
  });
});
