import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_INDEX,
  PLAY_MODES,
  SHUFFLE_MAX_ATTEMPTS,
  isPlayMode,
  nextPlayMode,
  pickNextIndex,
  pickPrevIndex,
  playModeInfo,
} from '../playmode';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pickNextIndex - list（列表循环）', () => {
  it('list 模式末尾 next → 回到 index 0', () => {
    expect(pickNextIndex('list', 4, 5, false)).toBe(0);
    expect(pickNextIndex('list', 4, 5, true)).toBe(0);
  });

  it('list 模式中间 next → index + 1', () => {
    expect(pickNextIndex('list', 1, 5, false)).toBe(2);
    expect(pickNextIndex('list', 1, 5, true)).toBe(2);
  });

  it('list 模式空队列 → -1', () => {
    expect(pickNextIndex('list', -1, 0, false)).toBe(NO_INDEX);
  });
});

describe('pickNextIndex - order（顺序播放）', () => {
  it('order 模式末尾 auto next → 返回 -1（播完停）', () => {
    expect(pickNextIndex('order', 4, 5, true)).toBe(-1);
  });

  it('order 模式手动 next → 正常 +1（即使已在末尾也回绕，旧版真实行为）', () => {
    expect(pickNextIndex('order', 1, 5, false)).toBe(2);
    expect(pickNextIndex('order', 4, 5, false)).toBe(0);
  });

  it('order 模式中间 auto next → index + 1', () => {
    expect(pickNextIndex('order', 2, 5, true)).toBe(3);
  });
});

describe('pickNextIndex - one（单曲循环）', () => {
  it('one 模式 auto → 返回同一 index', () => {
    expect(pickNextIndex('one', 3, 5, true)).toBe(3);
  });

  it('one 模式手动 next → 到下一首，末尾回绕', () => {
    expect(pickNextIndex('one', 3, 5, false)).toBe(4);
    expect(pickNextIndex('one', 4, 5, false)).toBe(0);
  });
});

describe('pickNextIndex - shuffle（随机播放）', () => {
  it('shuffle 单曲队列 → 返回 0', () => {
    expect(pickNextIndex('shuffle', 0, 1, false)).toBe(0);
    expect(pickNextIndex('shuffle', 0, 1, true)).toBe(0);
  });

  it('shuffle 多曲 → 返回值不等于当前 index', () => {
    // 前两次都命中当前 index=2，第三次才给出 3
    const seq = [0.5, 0.5, 0.8];
    let call = 0;
    const rng = (): number => seq[Math.min(call++, seq.length - 1)];
    expect(pickNextIndex('shuffle', 2, 4, false, rng)).toBe(3);
  });

  it('shuffle 的 50 次保护不导致死循环（Math.random 恒返回同一值）', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // floor(0.5*4)=2 === index
    const result = pickNextIndex('shuffle', 2, 4, false);
    expect(result).toBe(2);
    expect(spy.mock.calls.length).toBe(SHUFFLE_MAX_ATTEMPTS);
    expect(SHUFFLE_MAX_ATTEMPTS).toBe(50);
  });
});

describe('pickPrevIndex（上一首）', () => {
  it('prev 在非随机模式 → (index-1+n)%n', () => {
    expect(pickPrevIndex('list', 3, 5)).toBe(2);
    expect(pickPrevIndex('list', 0, 5)).toBe(4);
    expect(pickPrevIndex('order', 0, 5)).toBe(4);
    expect(pickPrevIndex('one', 2, 5)).toBe(1);
  });

  it('prev 在随机模式 → 随机索引（历史回退由 queue.popHistory 先负责）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    expect(pickPrevIndex('shuffle', 3, 5)).toBe(0);
  });

  it('空队列 → -1', () => {
    expect(pickPrevIndex('list', 0, 0)).toBe(-1);
    expect(pickPrevIndex('shuffle', 0, 0)).toBe(-1);
  });
});

describe('播放模式元数据', () => {
  it('轮转顺序 list → one → shuffle → order → list', () => {
    expect(nextPlayMode('list')).toBe('one');
    expect(nextPlayMode('one')).toBe('shuffle');
    expect(nextPlayMode('shuffle')).toBe('order');
    expect(nextPlayMode('order')).toBe('list');
  });

  it('PLAY_MODES 的 id/icon/label 与旧版一致', () => {
    expect(PLAY_MODES.map((m) => m.id)).toEqual(['list', 'one', 'shuffle', 'order']);
    expect(playModeInfo('one')).toEqual({ id: 'one', icon: 'repeatOne', label: '单曲循环' });
    expect(playModeInfo('order').label).toBe('顺序播放');
  });

  it('isPlayMode 能拒绝非法值', () => {
    expect(isPlayMode('shuffle')).toBe(true);
    expect(isPlayMode('random')).toBe(false);
    expect(isPlayMode(undefined)).toBe(false);
  });
});
