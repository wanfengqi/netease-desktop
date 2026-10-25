import { describe, expect, it } from 'vitest';
import {
  OFFSET_LIMIT_SECONDS,
  clampLyricOffset,
  currentIndexAt,
  emptyDoc,
  formatLyricOffset,
  indexAt,
  isEmptyDoc,
  isTimed,
  parseLrc,
  seekTimeForLine,
  shiftLines,
  type LyricLine,
} from '../lyrics';

const SAMPLE = [
  '[ti:晴天]',
  '[ar:周杰伦]',
  '[al:叶惠美]',
  '[by:someone]',
  '[00:00.00]晴天 - 周杰伦',
  '[00:12.50]故事的小黄花',
  '[00:17.20]从出生那年就飘着',
  '[00:22.60]童年的荡秋千',
].join('\n');

describe('parseLrc - 标准格式', () => {
  it('解析 [mm:ss.xx] 两条小数位', () => {
    const doc = parseLrc(SAMPLE);
    expect(doc.lines).toHaveLength(4);
    expect(doc.lines[1]).toEqual({ time: 12.5, text: '故事的小黄花' });
    expect(doc.lines[2].time).toBe(17.2);
  });

  it('元信息行进 meta，且不产生歌词行', () => {
    const doc = parseLrc(SAMPLE);
    expect(doc.meta.ti).toBe('晴天');
    expect(doc.meta.ar).toBe('周杰伦');
    expect(doc.meta.al).toBe('叶惠美');
    expect(doc.meta.by).toBe('someone');
    expect(doc.lines.some((l) => l.text === '晴天 - 周杰伦')).toBe(true);
  });

  it('毫秒三位 [mm:ss.xxx] 保留毫秒', () => {
    const doc = parseLrc('[00:01.234]a\n[01:02.005]b');
    expect(doc.lines).toEqual([
      { time: 1.234, text: 'a' },
      { time: 62.005, text: 'b' },
    ]);
  });

  it('一位小数与冒号分隔的旧写法都认', () => {
    const doc = parseLrc('[00:05.5]a\n[00:06:25]b\n[00:07]c');
    expect(doc.lines[0].time).toBe(5.5);
    expect(doc.lines[1].time).toBe(6.25);
    expect(doc.lines[2].time).toBe(7);
  });

  it('一行多时间标签展开成多条', () => {
    const doc = parseLrc('[00:10.00][01:20.00]副歌\n[00:30.00]主歌');
    expect(doc.lines.map((l) => l.time)).toEqual([10, 30, 80]);
    expect(doc.lines[0].text).toBe('副歌');
    expect(doc.lines[2].text).toBe('副歌');
  });

  it('乱序时间行按升序输出（相同时间保持原顺序）', () => {
    const doc = parseLrc('[00:30.00]c\n[00:10.00]a\n[00:20.00]b\n[00:10.00]a2');
    expect(doc.lines.map((l) => l.text)).toEqual(['a', 'a2', 'b', 'c']);
    expect(doc.lines.map((l) => l.time)).toEqual([10, 10, 20, 30]);
  });

  it('CRLF 与空行不影响解析', () => {
    const doc = parseLrc('[00:01.00]a\r\n\r\n[00:02.00]b\r\n');
    expect(doc.lines).toHaveLength(2);
  });

  it('[offset:] 毫秒写进 tagOffsetMs，不进歌词', () => {
    const doc = parseLrc('[offset:-250]\n[00:01.00]a');
    expect(doc.tagOffsetMs).toBe(-250);
    expect(doc.lines).toHaveLength(1);
  });

  it('未知元信息标签不当歌词文本', () => {
    const doc = parseLrc('[00:01.00][kana:か]a');
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0].text).toBe('a');
  });
});

describe('parseLrc - 边界', () => {
  it('空歌词 → 空时间轴、空纯文本', () => {
    const doc = parseLrc('');
    expect(doc.lines).toEqual([]);
    expect(doc.plain).toBe('');
    expect(isTimed(doc)).toBe(false);
    expect(isEmptyDoc(doc)).toBe(true);
  });

  it('只有元信息 → 不算有歌词（lines 空）', () => {
    const doc = parseLrc('[ti:纯音乐]\n[ar:未知]');
    expect(doc.lines).toEqual([]);
    expect(doc.plain).toBe('');
    expect(isEmptyDoc(doc)).toBe(true);
  });

  it('只有时间标签没有文本的行被丢弃', () => {
    const doc = parseLrc('[00:01.00]\n[00:02.00]a');
    expect(doc.lines).toEqual([{ time: 2, text: 'a' }]);
  });

  it('纯文本（无时间轴）落到 plain，供"未同步歌词"展示', () => {
    const doc = parseLrc('第一句\n第二句');
    expect(doc.lines).toEqual([]);
    expect(doc.plain).toBe('第一句\n第二句');
    expect(isEmptyDoc(doc)).toBe(false);
  });

  it('非字符串入参不抛异常', () => {
    expect(parseLrc(undefined as unknown as string).lines).toEqual([]);
  });

  it('emptyDoc 是空态', () => {
    expect(isEmptyDoc(emptyDoc())).toBe(true);
  });
});

describe('indexAt - 二分查找', () => {
  const lines: LyricLine[] = [10, 20, 30].map((t) => ({ time: t, text: 't' + t }));

  it('早于第一行 → -1', () => {
    expect(indexAt(lines, 0)).toBe(-1);
    expect(indexAt(lines, 9.999)).toBe(-1);
  });

  it('正好落在行时间 → 该行', () => {
    expect(indexAt(lines, 10)).toBe(0);
    expect(indexAt(lines, 20)).toBe(1);
  });

  it('行与行之间 → 前一行', () => {
    expect(indexAt(lines, 29.99)).toBe(1);
  });

  it('超过最后一行 → 最后一行', () => {
    expect(indexAt(lines, 999)).toBe(2);
  });

  it('空表 / NaN → -1', () => {
    expect(indexAt([], 10)).toBe(-1);
    expect(indexAt(lines, Number.NaN)).toBe(-1);
  });
});

describe('时轴微调（offset）', () => {
  const lines: LyricLine[] = [
    { time: 10, text: 'a' },
    { time: 20, text: 'b' },
    { time: 30, text: 'c' },
  ];

  it('offset=0 与原始时间轴一致', () => {
    expect(currentIndexAt(lines, 15, 0)).toBe(0);
    expect(shiftLines(lines, 0)).toEqual(lines);
  });

  it('offset 为正 → 歌词延后（与旧版 tt = t - offset 同语义）', () => {
    // 有效时间 = 实际进度 - offset；offset=+5 时 20s 的进度只落在原始 15s 的位置
    expect(currentIndexAt(lines, 15, 5)).toBe(0);
    expect(currentIndexAt(lines, 20, 5)).toBe(0);
    expect(currentIndexAt(lines, 25, 5)).toBe(1);
    expect(currentIndexAt(lines, 35, 5)).toBe(2);
  });

  it('offset 为负 → 歌词提前', () => {
    expect(currentIndexAt(lines, 15, -5)).toBe(1);
    expect(currentIndexAt(lines, 20, -5)).toBe(1);
    expect(currentIndexAt(lines, 25, -5)).toBe(2);
    expect(currentIndexAt(lines, 10, -5)).toBe(0);
  });

  it('当前行随 offset 实时改变（同一时刻，不同 offset 得到不同行）', () => {
    const indexes = [-10, -5, 0, 5, 10].map((o) => currentIndexAt(lines, 25, o));
    expect(indexes).toEqual([2, 2, 1, 1, 0]);
    // 且单调：offset 越大，当前行只会往前（不增）
    const increasing = [-10, -5, 0, 5, 10].map((o) => currentIndexAt(lines, 25, o));
    for (let i = 1; i < increasing.length; i += 1) {
      expect(increasing[i]).toBeLessThanOrEqual(increasing[i - 1]);
    }
  });

  it('shiftLines 只改时间不改文本，且不改原数组', () => {
    const shifted = shiftLines(lines, 2.5);
    expect(shifted.map((l) => l.time)).toEqual([12.5, 22.5, 32.5]);
    expect(shifted.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(lines.map((l) => l.time)).toEqual([10, 20, 30]);
  });

  it('shiftLines 结果与 currentIndexAt 的判定一致', () => {
    for (const offset of [-3, -1.5, 0, 1.5, 3]) {
      for (const t of [0, 5, 9.9, 12, 21, 33]) {
        expect(indexAt(shiftLines(lines, offset), t)).toBe(currentIndexAt(lines, t, offset));
      }
    }
  });

  it('点歌词行跳转时间 = 原始时间 + offset，且不为负', () => {
    expect(seekTimeForLine(lines[1], 2)).toBe(22);
    expect(seekTimeForLine(lines[0], 0)).toBe(10);
    expect(seekTimeForLine({ time: 1, text: 'x' }, -5)).toBe(0);
  });

  it('clamp 夹到 ±10s 并保留一位小数', () => {
    expect(clampLyricOffset(99)).toBe(OFFSET_LIMIT_SECONDS);
    expect(clampLyricOffset(-99)).toBe(-OFFSET_LIMIT_SECONDS);
    expect(clampLyricOffset(0.44)).toBe(0.4);
    expect(clampLyricOffset(Number.NaN)).toBe(0);
  });

  it('formatLyricOffset 带符号', () => {
    expect(formatLyricOffset(1)).toBe('+1.0s');
    expect(formatLyricOffset(-1.25)).toBe('-1.3s');
    expect(formatLyricOffset(0)).toBe('0.0s');
  });
});
