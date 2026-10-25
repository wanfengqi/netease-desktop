import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  addToQueue,
  clearQueue,
  createQueue,
  current,
  currentKey,
  isPlayableIndex,
  playNext,
  popHistory,
  removeAt,
  setQueue,
  visit,
  type QueueState,
} from '../queue';
import type { Song } from '../../data/normalize';

function song(id: number, source: Song['source'] = 'netease'): Song {
  return {
    id,
    source,
    name: `song-${id}`,
    artistText: 'A',
    artists: [{ name: 'A' }],
    album: { name: 'al' },
    duration: 180000,
  };
}

function makeQueue(size: number): QueueState {
  return createQueue(Array.from({ length: size }, (_, i) => song(i)));
}

describe('queue 基础', () => {
  it('createQueue 默认 index = -1、history 为空', () => {
    const q = createQueue([song(1)]);
    expect(q.index).toBe(-1);
    expect(q.history).toEqual([]);
    expect(current(q)).toBeNull();
    expect(currentKey(q)).toBe('');
  });

  it('currentKey 是跨源身份键 source:id', () => {
    const q = visit(createQueue([song(7, 'netease'), song(9, 'migu')]), 1);
    expect(currentKey(q)).toBe('migu:9');
    expect(isPlayableIndex(q, 1)).toBe(true);
    expect(isPlayableIndex(q, 2)).toBe(false);
  });

  it('setQueue 整表替换并清历史', () => {
    let q = makeQueue(5);
    q = visit(q, 0);
    q = visit(q, 3);
    expect(q.history).toEqual([0]);
    const replaced = setQueue([song(100)], 0);
    expect(replaced.items).toHaveLength(1);
    expect(replaced.history).toEqual([]);
    expect(replaced.index).toBe(0);
  });
});

describe('shuffleStack（跳转历史栈）', () => {
  it('压入 60 次后长度仍为 50（上限 50，溢出 shift 最旧）', () => {
    let q = createQueue(Array.from({ length: 61 }, (_, i) => song(i)));
    // visit(1) 时 index 还是 -1，不压栈；之后 2..60 每次压一个旧索引 = 59 次压栈
    for (let i = 1; i <= 60; i++) q = visit(q, i);
    expect(HISTORY_LIMIT).toBe(50);
    expect(q.history).toHaveLength(50);
    // 最旧的几个已被挤掉：栈底应为 10
    expect(q.history[0]).toBe(10);
    expect(q.history[q.history.length - 1]).toBe(59);
  });

  it('shuffleStack 回退后不再入栈（keepHistory 生效）', () => {
    let q = makeQueue(5);
    q = visit(q, 2); // 历史: [ ]
    q = visit(q, 4); // 历史: [2]
    expect(q.history).toEqual([2]);

    const popped = popHistory(q);
    expect(popped.index).toBe(2);
    expect(popped.state.history).toEqual([]);

    q = visit(popped.state, popped.index, { keepHistory: true });
    expect(q.index).toBe(2);
    expect(q.history).toEqual([]); // 回退动作本身不入栈
  });

  it('removeAt 不清理历史栈（旧版如此，靠 popHistory 的边界校验兜底）', () => {
    const q = visit(visit(makeQueue(5), 3), 4);
    expect(q.history).toEqual([3]);
    expect(removeAt(q, 3).state.history).toEqual([3]);
  });

  it('popHistory 丢弃过期索引（曲目已删除时静默跳过）', () => {
    // 手搓一个历史里全是失效索引的状态：队列只剩 1 首，栈里是 3 / 7
    const stale: QueueState = { items: [song(0)], index: 0, history: [3, 7] };
    const allStale = popHistory(stale);
    expect(allStale.index).toBe(-1); // 全部过期，调用方应改走 pickPrevIndex
    expect(allStale.state.history).toEqual([]);

    // 混合场景：栈顶 5 失效、下一层 1 有效 → 返回 1，且把 5 一起丢掉
    const mixed: QueueState = { items: [song(0), song(1)], index: 1, history: [1, 5] };
    const popped = popHistory(mixed);
    expect(popped.index).toBe(1);
    expect(popped.state.history).toEqual([]);
  });

  it('popHistory 在空栈上返回 -1 且不改动队列', () => {
    const q = makeQueue(3);
    const popped = popHistory(q);
    expect(popped.index).toBe(-1);
    expect(popped.state.items).toHaveLength(3);
  });
});

describe('removeAt', () => {
  it('removeAt 删除当前曲目后的索引正确性（续播 min(i, len-1)）', () => {
    let q = makeQueue(5);
    q = visit(q, 2);
    const r = removeAt(q, 2);
    expect(r.removedCurrent).toBe(true);
    expect(r.playIndex).toBe(2); // 原 3 号曲顶上来
    expect(r.state.index).toBe(2);
    expect(r.state.items).toHaveLength(4);
    expect(currentKey(r.state)).toBe('netease:3');
  });

  it('removeAt 删除末尾当前曲 → 索引回落到新的末位', () => {
    let q = makeQueue(3);
    q = visit(q, 2);
    const r = removeAt(q, 2);
    expect(r.playIndex).toBe(1);
    expect(r.state.index).toBe(1);
    expect(currentKey(r.state)).toBe('netease:1');
  });

  it('removeAt 删除当前曲且队列清空 → index = -1、无续播', () => {
    const q = visit(makeQueue(1), 0);
    const r = removeAt(q, 0);
    expect(r.removedCurrent).toBe(true);
    expect(r.playIndex).toBe(-1);
    expect(r.state.index).toBe(-1);
    expect(currentKey(r.state)).toBe('');
  });

  it('removeAt 删除当前曲之前的曲目 → index 前移但不触发播放', () => {
    const q = visit(makeQueue(5), 3);
    const r = removeAt(q, 1);
    expect(r.removedCurrent).toBe(false);
    expect(r.playIndex).toBe(-1);
    expect(r.state.index).toBe(2);
    expect(currentKey(r.state)).toBe('netease:3');
  });

  it('removeAt 删除当前曲之后的曲目 → index 不变', () => {
    const q = visit(makeQueue(5), 1);
    const r = removeAt(q, 3);
    expect(r.state.index).toBe(1);
    expect(currentKey(r.state)).toBe('netease:1');
  });

  it('removeAt 越界 → 原样返回', () => {
    const q = visit(makeQueue(2), 0);
    const r = removeAt(q, 9);
    expect(r.state).toBe(q);
    expect(r.removedCurrent).toBe(false);
  });
});

describe('clearQueue', () => {
  it('clearQueue 后 index = -1、currentKey 为空', () => {
    let q = makeQueue(4);
    q = visit(q, 1);
    q = visit(q, 3);
    const cleared = clearQueue();
    expect(cleared.items).toEqual([]);
    expect(cleared.index).toBe(-1);
    expect(cleared.history).toEqual([]);
    expect(current(cleared)).toBeNull();
    expect(currentKey(cleared)).toBe('');
  });
});

describe('入队', () => {
  it('addToQueue 追加到队尾且不动 index', () => {
    const q = addToQueue(visit(makeQueue(2), 0), song(99));
    expect(q.items.map((s) => s.id)).toEqual([0, 1, 99]);
    expect(q.index).toBe(0);
  });

  it('playNext 插到当前曲之后（不打断当前播放）', () => {
    const q = playNext(visit(makeQueue(3), 1), song(99));
    expect(q.items.map((s) => s.id)).toEqual([0, 1, 99, 2]);
    expect(q.index).toBe(1);
  });

  it('playNext 在空队列时退化为 push 并把 index 拨到 0', () => {
    const q = playNext(createQueue(), song(99));
    expect(q.items.map((s) => s.id)).toEqual([99]);
    expect(q.index).toBe(0);
  });

  it('visit 越界索引不改状态', () => {
    const q = makeQueue(2);
    expect(visit(q, 5)).toBe(q);
    expect(visit(q, -1)).toBe(q);
  });
});
