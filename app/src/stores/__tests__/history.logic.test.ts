import { describe, expect, it } from 'vitest';
import { key } from '../../data/normalize';
import type { Song, SongSource } from '../../data/normalize';
import {
  EXTRA_HISTORY_KEY,
  HISTORY_LIMIT,
  appendHistory,
  groupHistoryByDay,
  parseStoredHistory,
  type HistoryEntry,
} from '../history';

function song(id: string | number, source: SongSource = 'netease', name = '晴天'): Song {
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

const S1 = song(1, 'netease', 'A');
const S2 = song(2, 'netease', 'B');
const MIGU_1 = song(1, 'migu', 'A(咪咕)');

const T0 = 1700000000000; // 2023-11-15 06:13:20 UTC

describe('播放历史 - 追加记录', () => {
  it('新记录排在最前，并带上 source:id 与时间戳', () => {
    let list: HistoryEntry[] = [];
    list = appendHistory(list, S1, T0);
    list = appendHistory(list, S2, T0 + 60000);
    expect(list.map((e) => e.key)).toEqual(['netease:2', 'netease:1']);
    expect(list[0].playedAt).toBe(T0 + 60000);
    expect(list[1].song.name).toBe('A');
  });

  it('同一首歌短时间内连播只留一条（单曲循环不会灌爆历史）', () => {
    let list = appendHistory([], S1, T0);
    list = appendHistory(list, S1, T0 + 1000);
    list = appendHistory(list, S1, T0 + 2000);
    expect(list).toHaveLength(1);
    expect(list[0].playedAt).toBe(T0 + 2000); // 时间刷新到最近一次
  });

  it('同一首歌间隔超过 5 分钟会另起一条（真的又听了一遍）', () => {
    let list = appendHistory([], S1, T0);
    list = appendHistory(list, S1, T0 + 6 * 60 * 1000);
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.playedAt)).toEqual([T0 + 360000, T0]);
  });

  it('中间插了别的歌，再听回 S1 会另起一条', () => {
    let list = appendHistory([], S1, T0);
    list = appendHistory(list, S2, T0 + 1000);
    list = appendHistory(list, S1, T0 + 2000);
    expect(list.map((e) => e.key)).toEqual(['netease:1', 'netease:2', 'netease:1']);
  });

  it('网易云与咪咕的同 id 歌在历史里是两条不同记录', () => {
    let list = appendHistory([], S1, T0);
    list = appendHistory(list, MIGU_1, T0 + 1000);
    expect(list.map((e) => e.key)).toEqual(['migu:1', 'netease:1']);
  });

  it('缺 id 的歌不入历史（没有可定位的身份）', () => {
    expect(appendHistory([], song(''), T0)).toEqual([]);
  });

  it('超过上限后裁掉最老的记录', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      list = appendHistory(list, song(i + 10000), T0 + i * 1000);
    }
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].key).toBe('netease:' + String(HISTORY_LIMIT + 10004));
  });

  it('上限可注入（测试与小规模场景不必跑满 5000）', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 5; i += 1) list = appendHistory(list, song(i), T0 + i, 3);
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.key)).toEqual(['netease:4', 'netease:3', 'netease:2']);
  });
});

describe('播放历史 - 按天分组', () => {
  const NOW = new Date(2024, 4, 20, 12, 0, 0).getTime(); // 本地 2024-05-20 12:00
  const dayMs = 24 * 60 * 60 * 1000;

  it('今天 / 昨天 用中文标签，更早的用日期', () => {
    const list: HistoryEntry[] = [
      { key: 'netease:3', song: S1, playedAt: NOW },
      { key: 'netease:2', song: S2, playedAt: NOW - dayMs },
      { key: 'netease:1', song: S1, playedAt: NOW - 3 * dayMs },
    ];
    const groups = groupHistoryByDay(list, NOW);
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '2024-05-17']);
    expect(groups.map((g) => g.entries.length)).toEqual([1, 1, 1]);
  });

  it('同一天的记录聚成一组，顺序保持输入顺序', () => {
    const list: HistoryEntry[] = [
      { key: 'netease:3', song: S1, playedAt: NOW },
      { key: 'netease:2', song: S2, playedAt: NOW - 1000 },
      { key: 'netease:1', song: S1, playedAt: NOW - dayMs },
    ];
    const groups = groupHistoryByDay(list, NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0].entries.map((e) => e.key)).toEqual(['netease:3', 'netease:2']);
    expect(groups[1].entries.map((e) => e.key)).toEqual(['netease:1']);
  });

  it('空历史 → 空分组（不产生一个空壳组）', () => {
    expect(groupHistoryByDay([], NOW)).toEqual([]);
  });

  it('day 字段是本地时区的 YYYY-MM-DD', () => {
    const groups = groupHistoryByDay([{ key: 'netease:1', song: S1, playedAt: NOW }], NOW);
    expect(groups[0].day).toBe('2024-05-20');
  });
});

describe('播放历史 - 持久化解析', () => {
  it('正常数据还原 key 与时间戳', () => {
    const raw = [{ song: S1, playedAt: T0 }, { song: S2, playedAt: T0 + 1 }];
    const parsed = parseStoredHistory(raw);
    expect(parsed.map((e) => e.key)).toEqual(['netease:1', 'netease:2']);
    expect(parsed[0].playedAt).toBe(T0);
  });

  it('非数组 / 坏条目 / 缺 song 被丢掉，不影响其它条目', () => {
    expect(parseStoredHistory(null)).toEqual([]);
    expect(parseStoredHistory('x')).toEqual([]);
    const parsed = parseStoredHistory([
      { song: S1, playedAt: T0 },
      { playedAt: T0 },
      { song: { source: 'netease' }, playedAt: T0 },
      null,
      'bad',
    ]);
    expect(parsed.map((e) => e.key)).toEqual(['netease:1']);
  });

  it('重复 key 只留第一条（防止外部写坏导致同一首堆满）', () => {
    const parsed = parseStoredHistory([
      { song: S1, playedAt: T0 },
      { song: S1, playedAt: T0 + 1 },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it('缺 playedAt 的历史条目时间戳归零而不是丢弃', () => {
    const parsed = parseStoredHistory([{ song: S1 }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].playedAt).toBe(0);
  });

  it('落盘形态是 JSON 字符串，parse 能原样还原', () => {
    const raw = JSON.stringify([{ song: S1, playedAt: T0 }]);
    const parsed = parseStoredHistory(raw);
    expect(parsed.map((e) => e.key)).toEqual(['netease:1']);
    expect(parsed[0].playedAt).toBe(T0);
  });

  it('字符串被改坏（非法 JSON）时返回空，不抛异常', () => {
    expect(parseStoredHistory('{坏掉的')).toEqual([]);
    expect(parseStoredHistory('"not-an-array"')).toEqual([]);
    expect(parseStoredHistory('')).toEqual([]);
  });

  it('extra 键名固定为 history（改了这个键会丢用户历史）', () => {
    expect(EXTRA_HISTORY_KEY).toBe('history');
  });

  it('key() 与历史条目的 key 字段一致（写盘与内存同一口径）', () => {
    const parsed = parseStoredHistory([{ song: MIGU_1, playedAt: T0 }]);
    expect(parsed[0].key).toBe(key(MIGU_1));
    expect(parsed[0].key).toBe('migu:1');
  });
});
