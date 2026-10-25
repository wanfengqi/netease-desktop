/**
 * 播放历史 store（S6）—— 完整流水，不是"最近 30 条"。
 *
 * 与 config.recent 的分工：
 *   recent  = 旧 schema 的 30 条歌曲快照，只用来做"最近播放"入口；
 *   history = 本 store 的**全量**记录，带 playedAt 时间戳，可按天浏览、可单条删除、可清空。
 *
 * 落盘同样走 config.update() 的单一防抖通道（旧 2.5：不许任何人绕过去自己写盘）。
 * 存在 config.extra 里 —— 旧 13 键 schema 不用改，S2 的迁移逻辑也不必动。
 *
 * 记录入口：watch(player.songKey)。LibraryView 挂载时 startTracking() 一次即可；
 * 要让"从头到尾都记"，协调者在 App.vue 里 onMounted 调一次 useHistoryStore().startTracking()。
 */
import { defineStore } from 'pinia';
import { computed, shallowRef, watch } from 'vue';
import { key as songKey } from '../data/normalize';
import type { Song } from '../data/normalize';
import { useConfigStore } from './config';
import { usePlayerStore } from './player';

/** 无上限会把这一个 JSON 文件撑爆；5000 条 ≈ 普通人几年的听歌量 */
export const HISTORY_LIMIT = 5000;

/** config.extra 里的键（storage 层不校验 extra，所以这里自己写解析） */
export const EXTRA_HISTORY_KEY = 'history';

export interface HistoryEntry {
  /** source:id，导出/去重/定位都靠它 */
  key: string;
  song: Song;
  /** 毫秒时间戳 */
  playedAt: number;
}

/**
 * 追加一条播放记录。
 * 连续播同一首（单曲循环）时**合并**成一条并刷新时间 —— 否则单曲循环一夜就是几万条。
 * 判定：上一条是同 key 且间隔 < 5 分钟。
 */
export function appendHistory(
  list: readonly HistoryEntry[],
  song: Song,
  now: number,
  limit: number = HISTORY_LIMIT,
): HistoryEntry[] {
  const k = songKey(song);
  if (!k) return [...list];
  const head = list[0];
  if (head && head.key === k && now - head.playedAt < 5 * 60 * 1000) {
    return [{ key: k, song, playedAt: now }, ...list.slice(1)];
  }
  return [{ key: k, song, playedAt: now }, ...list].slice(0, limit);
}

export interface HistoryGroup {
  /** YYYY-MM-DD（本地时区） */
  day: string;
  /** 今天 / 昨天 / YYYY-MM-DD */
  label: string;
  entries: HistoryEntry[];
}

function dayOf(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/** 按天分组（输入假定已按 playedAt 倒序，即 store 的自然顺序） */
export function groupHistoryByDay(list: readonly HistoryEntry[], now: number = Date.now()): HistoryGroup[] {
  const today = dayOf(now);
  const yesterday = dayOf(now - 24 * 60 * 60 * 1000);
  const groups: HistoryGroup[] = [];
  for (const entry of list) {
    const day = dayOf(entry.playedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.entries.push(entry);
      continue;
    }
    const label = day === today ? '今天' : day === yesterday ? '昨天' : day;
    groups.push({ day, label, entries: [entry] });
  }
  return groups;
}

/**
 * 从 config.extra 里捡回历史（外部可改坏，所以逐条校验，坏的直接丢）。
 *
 * 落盘形态是 **JSON 字符串**而不是对象数组，原因见 persist() 的注释。
 * 同时兼容数组（旧数据 / 手写配置）。
 */
export function parseStoredHistory(raw: unknown): HistoryEntry[] {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return parseHistoryArray(value);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseHistoryArray(raw: unknown[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const song = rec.song as Song | undefined;
    if (!song || typeof song !== 'object') continue;
    const k = songKey(song);
    if (!k || seen.has(k)) continue;
    const playedAt = typeof rec.playedAt === 'number' && Number.isFinite(rec.playedAt) ? rec.playedAt : 0;
    seen.add(k);
    out.push({ key: k, song, playedAt });
  }
  return out;
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export const useHistoryStore = defineStore('history', () => {
  const config = useConfigStore();
  const player = usePlayerStore();

  /** shallowRef：见 favorites.ts 的说明 —— 记录里的 Song 必须是普通对象 */
  const entries = shallowRef<HistoryEntry[]>([]);
  let tracking = false;
  /** 上次看到的 songKey，用来忽略"同一首的重复通知" */
  let lastKey = '';

  const count = computed(() => entries.value.length);
  const groups = computed(() => groupHistoryByDay(entries.value));
  /** 前 30 条，给"最近播放"入口用（与 config.recent 同一语义，但带时间戳） */
  const recent30 = computed<HistoryEntry[]>(() => entries.value.slice(0, 30));

  /**
   * 历史**必须序列化成 JSON 字符串**再放进 config.extra，不能用对象数组。
   *
   * 这是本次踩到的真坑（不只是"代理不能 clone"那么表面）：
   * config.saveQueue() 会做 `{ ...config.value.extra, queueKey }`，
   * 而 config.value 是深度 ref —— 展开外层对象拿到的是 **Vue 代理**，
   * 代理塞进 IPC 时结构化克隆直接抛 "An object could not be cloned."，
   * 于是 player 的队列写盘静默失败。
   * 把 extra 里的自定义数据全部收敛成字符串后，外层展开拿到的就只是原始值，
   * 除非有人再去动它，否则不会再触发克隆。
   *
   * 附带好处：写盘体积更小，且不会因为 Vue 代理把整个歌对象图拖进去。
   */
  function persist(next: HistoryEntry[]): void {
    entries.value = next;
    // 字符串而不是对象数组：见方法上方注释
    const extra = { ...(config.config?.extra ?? {}), [EXTRA_HISTORY_KEY]: toJson(next) };
    config.update({ extra });
  }

  /** 从配置载入（幂等；已有数据时后来者不覆盖用户刚产生的记录） */
  function hydrate(): void {
    const stored = parseStoredHistory(config.config?.extra?.[EXTRA_HISTORY_KEY]);
    if (stored.length > 0 && entries.value.length === 0) entries.value = stored;
  }

  /** 记录一次播放。重复 key 同一时刻的重复调用被忽略。 */
  function record(song: Song | null | undefined, now: number = Date.now()): void {
    if (!song) return;
    const k = songKey(song);
    if (!k) return;
    entries.value = appendHistory(entries.value, song, now);
    persist(entries.value);
  }

  /** 接上播放器：任何一首开始播就记一条（幂等，重复调用无副作用） */
  function startTracking(): void {
    if (tracking) return;
    tracking = true;
    hydrate();
    watch(
      () => player.songKey,
      (k) => {
        if (!k || k === lastKey) return;
        lastKey = k;
        record(player.song);
      },
      { immediate: true },
    );
  }

  function clear(): void {
    persist([]);
  }

  /** 删单条：key + 时间戳一起定位（同一首歌在历史里可能出现多次） */
  function remove(target: { key: string; playedAt: number }): void {
    const next = entries.value.filter((e) => !(e.key === target.key && e.playedAt === target.playedAt));
    if (next.length === entries.value.length) return;
    persist(next);
  }

  return { entries, count, groups, recent30, record, startTracking, clear, remove, hydrate };
});
