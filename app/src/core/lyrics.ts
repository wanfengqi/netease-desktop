/**
 * LRC 歌词引擎（S4）—— 纯函数：无 DOM、无 IO、无 Vue。
 *
 * 旧版（src/renderer/views.js）把解析、偏移、二分查找三件事揉在视图里，
 * 于是"偏移后当前行不对"这种问题只能靠肉眼验。这里拆成可测的纯函数：
 *
 *   parseLrc        → LyricDoc（时间轴 + 元信息 + 纯文本兜底）
 *   currentIndexAt  → 二分查找当前行（旧版 currentLyricIndex 的行为，含 ± 偏移）
 *   shiftLines      → 按偏移折算后的显示用时间轴
 *
 * 偏移语义与旧版完全一致（旧 src/renderer/views.js:753，tt = t - state.lyricOffset）：
 *   比较用时间 = 播放进度 - offset
 *   即 offset 为正时歌词**延后**出现（字幕慢于歌声时往正方向拨）。
 *   显示用时间轴 / 点行跳转都是 raw.time + offset（旧版 views.js:841 同式）：
 *   在 t = raw + offset 那一刻，indexAt 恰好落到该行，三条式子互相自洽。
 *
 * 时间标签支持：
 *   [mm:ss]  [mm:ss.x]  [mm:ss.xx]  [mm:ss.xxx]  [mm:ss:xx]（冒号分隔的旧写法）
 *   一行多标签（[00:10.00][01:20.00]副歌）展开成多条
 * 元信息行：[ti:] [ar:] [al:] [by:] [offset:]（其余 [xx:] 一律忽略，不当作歌词文本）
 */

/** 一行歌词；time 单位为秒（保留到毫秒精度） */
export interface LyricLine {
  readonly time: number;
  readonly text: string;
}

export interface LyricMeta {
  readonly ti: string;
  readonly ar: string;
  readonly al: string;
  readonly by: string;
}

export interface LyricDoc {
  /** 按时间升序；无时间轴时为空数组 */
  readonly lines: readonly LyricLine[];
  readonly meta: LyricMeta;
  /** [offset:] 标签里的毫秒值（不少 LRC 文件用负值表示"歌词提前"） */
  readonly tagOffsetMs: number;
  /** 没有任何时间标签但有文本时的原文（咪咕部分接口给纯文本歌词） */
  readonly plain: string;
  readonly raw: string;
}

/** 时间标签上限 999 分钟，避免把 "[2024:01]" 这类垃圾当时间 */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(ti|ar|al|by|offset|length|re|ve|au):([^\]]*)\]$/i;
const ANY_TAG = /\[[^\]]*\]/g;

/** 偏移上限（秒）：旧版是 ±10s，超出没有实际意义，只会把歌词整段甩飞 */
export const OFFSET_LIMIT_SECONDS = 10;

export const EMPTY_META: LyricMeta = { ti: '', ar: '', al: '', by: '' };

/** 小数位 → 秒：'.5'→0.5  '.05'→0.05  '.005'→0.005 */
function fractionToSeconds(frac: string | undefined): number {
  if (!frac) return 0;
  const digits = frac.slice(0, 3);
  return Number(digits) / 10 ** digits.length;
}

/** m:ss 的分钟部分允许 1-3 位，秒部分 1-2 位（个别文件写 [1:5.00]） */
function timeTagToSeconds(minute: string, second: string, frac: string | undefined): number {
  const m = Number(minute);
  const s = Number(second);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return Number.NaN;
  return Math.round((m * 60 + s + fractionToSeconds(frac)) * 1000) / 1000;
}

/**
 * 解析 LRC。
 * 行为约定（与 S4 验收项一一对应）：
 *  · 空字符串 → lines 为空、plain 为空、meta 全空
 *  · 只有元信息行 → lines 为空（不是"有一行空歌词"）
 *  · 时间行但文本为空（如 "[00:10.00]" 单独一行）→ 丢弃
 *  · 乱序时间行 → 输出按时间升序（相同时间保持原顺序）
 *  · 无时间标签的文本 → 进 plain，lines 仍为空
 */
export function parseLrc(raw: string): LyricDoc {
  const source = typeof raw === 'string' ? raw : '';
  const meta = { ti: '', ar: '', al: '', by: '' };
  let tagOffsetMs = 0;
  const lines: LyricLine[] = [];
  const untimed: string[] = [];

  for (const rawLine of source.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const metaMatch = META_TAG.exec(line);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      const value = metaMatch[2].trim();
      if (key === 'ti' || key === 'ar' || key === 'al' || key === 'by') {
        meta[key] = value;
      } else if (key === 'offset') {
        const parsed = Number(value.replace(/^\+/, ''));
        if (Number.isFinite(parsed)) tagOffsetMs = parsed;
      }
      continue;
    }

    const times: number[] = [];
    for (const match of line.matchAll(TIME_TAG)) {
      const seconds = timeTagToSeconds(match[1], match[2], match[3]);
      if (Number.isFinite(seconds)) times.push(seconds);
    }

    const text = line.replace(ANY_TAG, '').trim();

    if (times.length === 0) {
      if (text !== '') untimed.push(text);
      continue;
    }
    if (text === '') continue;
    for (const time of times) lines.push({ time, text });
  }

  lines.sort((a, b) => a.time - b.time);

  return {
    lines,
    meta,
    tagOffsetMs,
    plain: lines.length === 0 ? untimed.join('\n') : '',
    raw: source,
  };
}

export function emptyDoc(): LyricDoc {
  return { lines: [], meta: EMPTY_META, tagOffsetMs: 0, plain: '', raw: '' };
}

/** 是否有可滚动的时间轴 */
export function isTimed(doc: LyricDoc): boolean {
  return doc.lines.length > 0;
}

/** 完全没内容（既无时间轴也无纯文本） */
export function isEmptyDoc(doc: LyricDoc): boolean {
  return doc.lines.length === 0 && doc.plain === '';
}

/** 偏移夹取到 ±OFFSET_LIMIT_SECONDS，非数字归零 */
export function clampLyricOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10) / 10;
  if (rounded > OFFSET_LIMIT_SECONDS) return OFFSET_LIMIT_SECONDS;
  if (rounded < -OFFSET_LIMIT_SECONDS) return -OFFSET_LIMIT_SECONDS;
  return rounded;
}

/** '+0.5s' / '-1.2s' / '0.0s' */
export function formatLyricOffset(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe > 0 ? '+' : '';
  return sign + safe.toFixed(1) + 's';
}

/**
 * 折算成"显示用时间轴"：time + offset。
 * 与 currentIndexAt 的判定等价（indexAt(shiftLines(l, o), t) === currentIndexAt(l, t, o)）：
 *   t - offset >= raw  ⟺  t >= raw + offset
 * 供桌面歌词窗使用 —— 那边只收到一条时间轴，偏移必须已经折算进去，两边才不会漂。
 */
export function shiftLines(lines: readonly LyricLine[], offsetSeconds: number): LyricLine[] {
  const offset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  if (offset === 0) return lines.slice();
  return lines.map((line) => ({
    time: Math.round((line.time + offset) * 1000) / 1000,
    text: line.text,
  }));
}

/**
 * 二分查找：返回最后一个 time <= seconds 的下标；都比它大则 -1。
 * 移植自旧版 currentLyricIndex（views.js:751），额外加了 NaN / 空表防护。
 */
export function indexAt(lines: readonly LyricLine[], seconds: number): number {
  if (lines.length === 0) return -1;
  if (!Number.isFinite(seconds)) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * 当前行下标（含偏移）。lines 传**原始**时间轴。
 * 等价于 indexAt(shiftLines(lines, offset), time)，但只算一次二分。
 */
export function currentIndexAt(
  lines: readonly LyricLine[],
  seconds: number,
  offsetSeconds: number,
): number {
  const offset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  if (!Number.isFinite(seconds)) return -1;
  return indexAt(lines, Math.round((seconds - offset) * 1000) / 1000);
}

/** 点歌词行跳转的目标时间（秒）：raw.time + offset，负数归零 */
export function seekTimeForLine(line: LyricLine, offsetSeconds: number): number {
  const offset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  const target = Math.round((line.time + offset) * 1000) / 1000;
  return target > 0 ? target : 0;
}
