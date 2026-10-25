/**
 * 歌词 store + 桌面歌词/迷你模式桥接（S4）。
 *
 * 职责边界：
 *  1. **取歌词**：按 song.source 分派 —— 网易云走 netease.lyric(id)，咪咕走 migu.lyric(contentId)。
 *     咪咕的 lrcUrl 二次抓取兜底在 repository 里（migu.ts:229），这层不重复实现。
 *  2. **持有偏移**：唯一真源是 config.lyricOffset（旧版就是这么存的），这里只是响应式投影；
 *     写盘走 config.update（config.ts 本批次禁止修改，update 是它的公开入口）。
 *  3. **算当前行**：纯函数 currentIndexAt 负责二分，组件只读 index。
 *  4. **桥接附属窗口**：见文件后半段 startDesktopLyricBridge —— 主窗口是唯一真源，
 *     歌词窗/迷你窗只接收，不回写。
 *
 * 并发：切歌时用 token 丢弃过期响应（与 core/player.ts 同一套思路）——
 * 否则"A 歌的歌词回来晚了、盖在 B 歌上"这种错乱在慢网络下一定会出现。
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  clampLyricOffset,
  currentIndexAt,
  emptyDoc,
  formatLyricOffset,
  isEmptyDoc,
  isTimed,
  parseLrc,
  seekTimeForLine,
  shiftLines,
  type LyricDoc,
  type LyricLine,
} from '../core/lyrics';
import type { Song } from '../data/normalize';
import { migu, netease } from '../data/repository/index';
import { useConfigStore } from './config';
import { usePlayerStore } from './player';

/** 歌词来源标签，给空态文案用（"网易云未返回歌词" vs "咪咕未返回歌词"） */
export type LyricSourceLabel = '网易云' | '咪咕';

/** 推给桌面歌词窗的整包数据；lines 里的 time 已经折算过 offset */
export interface LyricSnapshot {
  lines: { time: number; text: string }[];
  title: string;
  artist: string;
  offset: number;
}

export const useLyricsStore = defineStore('lyrics', () => {
  const config = useConfigStore();

  const doc = ref<LyricDoc>(emptyDoc());
  const songKey = ref('');
  const songTitle = ref('');
  const sourceLabel = ref<LyricSourceLabel>('网易云');
  const loading = ref(false);
  const error = ref('');
  const offset = ref(0);

  /** 取歌词的会话 token：只有最后一次请求的结果能落地 */
  let token = 0;
  let seeded = false;

  /** 从配置里播一次初值（config 可能在 store 创建之后才加载完） */
  function seedOffset(): void {
    if (seeded) return;
    const raw = config.config?.lyricOffset;
    if (typeof raw !== 'number') return;
    offset.value = clampLyricOffset(raw);
    seeded = true;
  }
  seedOffset();
  watch(
    () => config.config?.lyricOffset,
    () => {
      if (seeded) return;
      seedOffset();
    },
  );

  const lines = computed<readonly LyricLine[]>(() => doc.value.lines);
  /** 折算过偏移的显示用时间轴（桌面歌词窗也吃这一份） */
  const shiftedLines = computed<readonly LyricLine[]>(() => shiftLines(doc.value.lines, offset.value));
  const hasLyrics = computed(() => isTimed(doc.value));
  /** 既无时间轴也无纯文本 —— 显示明确空态（不是空白） */
  const isEmpty = computed(() => isEmptyDoc(doc.value));
  /** 无时间轴但有纯文本（部分咪咕接口只给纯文本歌词） */
  const plainText = computed(() => doc.value.plain);
  const offsetLabel = computed(() => formatLyricOffset(offset.value));

  async function fetchRaw(song: Song): Promise<{ raw: string; translation: string }> {
    if (song.source === 'migu') {
      const data = await migu.lyric(song.contentId ?? String(song.id));
      return { raw: data.lyric, translation: data.translation };
    }
    const data = await netease.lyric(song.id);
    return { raw: data.lyric, translation: data.translation };
  }

  /** 载入某首歌的歌词；同一首歌且已有内容时直接返回（切歌才重取） */
  async function load(song: Song | null): Promise<void> {
    const currentToken = ++token;
    error.value = '';
    if (!song) {
      doc.value = emptyDoc();
      songKey.value = '';
      songTitle.value = '';
      return;
    }
    const key = (song.source || 'netease') + ':' + String(song.id ?? song.contentId ?? '');
    songTitle.value = song.name;
    sourceLabel.value = song.source === 'migu' ? '咪咕' : '网易云';
    if (key === songKey.value && !isEmptyDoc(doc.value)) return;

    songKey.value = key;
    doc.value = emptyDoc();
    loading.value = true;
    try {
      const { raw } = await fetchRaw(song);
      if (currentToken !== token) return; // 过期响应：静默丢弃
      doc.value = parseLrc(raw);
    } catch (err) {
      if (currentToken !== token) return;
      doc.value = emptyDoc();
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (currentToken === token) loading.value = false;
    }
  }

  function indexAt(seconds: number): number {
    return currentIndexAt(doc.value.lines, seconds, offset.value);
  }

  /** 点某行 → 目标播放位置（秒），已含偏移 */
  function seekTargetFor(index: number): number {
    const line = doc.value.lines[index];
    if (!line) return 0;
    return seekTimeForLine(line, offset.value);
  }

  function setOffset(value: number): void {
    const next = clampLyricOffset(value);
    offset.value = next;
    seeded = true;
    config.update({ lyricOffset: next });
  }

  function nudgeOffset(delta: number): void {
    setOffset(offset.value + delta);
  }

  function resetOffset(): void {
    setOffset(0);
  }

  /** 桌面歌词窗用的快照（歌词行已折算偏移，那边不再算） */
  function snapshot(title: string, artist: string): LyricSnapshot {
    return {
      lines: shiftedLines.value.map((line) => ({ time: line.time, text: line.text })),
      title,
      artist,
      offset: offset.value,
    };
  }

  return {
    doc,
    songKey,
    songTitle,
    sourceLabel,
    loading,
    error,
    offset,
    lines,
    shiftedLines,
    hasLyrics,
    isEmpty,
    plainText,
    offsetLabel,
    load,
    indexAt,
    seekTargetFor,
    setOffset,
    nudgeOffset,
    resetOffset,
    snapshot,
  };
});

// ==========================================================================
//                    桌面歌词窗 / 迷你窗桥接（主窗口侧）
// ==========================================================================

/** 主题色：直接取 :root 的计算样式，避免两个进程各写一份色板 */
const THEME_VARS = ['--accent', '--text-strong', '--app-bg', '--panel-bg', '--text-muted'] as const;

interface LyricApiLike {
  push(payload: unknown): void;
  toggle(): Promise<boolean>;
  close(): Promise<boolean>;
  isOpen(): Promise<boolean>;
  onCmd(handler: (command: string) => void): () => void;
  onWindowReady(handler: () => void): () => void;
  onClosed(handler: () => void): () => void;
}

/** window.api.mini —— 主窗口侧只用到"指令"；数据推送与窗口开关都在 api.win 上 */
interface MiniApiLike {
  cmd(command: string): void;
  onCmd?(handler: (command: string) => void): () => void;
}

interface WinApiLike {
  /** 主窗口侧：把迷你窗要显示的内容推过去 */
  pushMini?(payload: unknown): void;
  enterMini?(): Promise<boolean>;
  exitMini?(): Promise<boolean>;
  isMini?(): Promise<boolean>;
  onMiniRequestState?(handler: () => void): () => void;
}

interface WindowApiLike {
  lyric?: LyricApiLike;
  mini?: MiniApiLike;
  win?: WinApiLike;
}

function attachApi(): WindowApiLike | null {
  const w = (globalThis as unknown as { window?: { api?: WindowApiLike } }).window;
  return w?.api ?? null;
}

function readTheme(): Record<string, string> {
  const theme: Record<string, string> = {};
  if (typeof document === 'undefined') return theme;
  const style = getComputedStyle(document.documentElement);
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) theme[name] = value;
  }
  return theme;
}

let bridgeStarted = false;
/** 桥接启动后留一份上下文，供模块级动作（切换迷你模式等）复用 */
let bridgeCtx: {
  player: ReturnType<typeof usePlayerStore>;
  lyrics: ReturnType<typeof useLyricsStore>;
} | null = null;

/** 把当前歌曲/播放状态整包推给迷你窗（迷你窗是独立进程，没有 store） */
function pushMiniState(): void {
  const api = attachApi();
  const ctx = bridgeCtx;
  if (!api?.win?.pushMini || !ctx) return;
  const song = ctx.player.song;
  api.win.pushMini({
    title: song?.name ?? '未在播放',
    artist: song?.artistText ?? '主窗口里点一首歌',
    cover: song?.album.picUrl ?? '',
    playing: ctx.player.playing,
    progress: ctx.player.progress,
  });
}

/** 把当前歌曲/歌词整包推给桌面歌词窗（lines 里的时间已折算偏移） */
function pushLyricState(): void {
  const api = attachApi();
  const ctx = bridgeCtx;
  if (!api?.lyric || !ctx) return;
  const song = ctx.player.song;
  api.lyric.push({ kind: 'track', ...ctx.lyrics.snapshot(song?.name ?? '', song?.artistText ?? '') });
  api.lyric.push({ kind: 'state', playing: ctx.player.playing, theme: readTheme() });
}

/**
 * 启动附属窗口桥接。**幂等**，返回停止函数。
 *
 * 由 PlayerView.vue 在挂载时调用（那是本批次唯一能新增 UI 的地方）。
 * 若将来要在应用启动时就生效（比如"记住上次开着桌面歌词"），
 * 协调者在 App.vue 里加一行 startDesktopLyricBridge() 即可，本函数不依赖 setup 上下文。
 */
export function startDesktopLyricBridge(): () => void {
  if (bridgeStarted) return () => undefined;
  const api = attachApi();
  if (!api?.lyric && !api?.mini) return () => undefined;
  bridgeStarted = true;

  const player = usePlayerStore();
  const lyrics = useLyricsStore();

  /** 副歌：把当前歌曲/歌词整包推给两个附属窗口 */
  bridgeCtx = { player, lyrics };

  const pushTrack = pushLyricState;
  const pushMini = pushMiniState;

  function runCommand(command: string): void {
    if (command === 'toggle') void player.toggle();
    else if (command === 'prev') void player.prev();
    else if (command === 'next') void player.next();
    else if (command === 'offset-') lyrics.nudgeOffset(-0.5);
    else if (command === 'offset+') lyrics.nudgeOffset(0.5);
  }

  // 换歌 → 取歌词 → 整包推送（token 由 store 管，过期的不会落地）
  const stopSongWatch = watch(
    () => player.songKey,
    () => {
      void lyrics.load(player.song).then(() => {
        pushTrack();
        pushMini();
      });
    },
    { immediate: true },
  );

  // 偏移变化 → 重推时间轴（桌面歌词窗必须跟着变，否则两个窗口对不上）
  const stopOffsetWatch = watch(
    () => lyrics.offset,
    () => pushTrack(),
  );

  // 进度 tick：500ms，与 player store 的进度轮询同频
  const timer = setInterval(() => {
    const song = player.song;
    if (!song) return;
    api?.lyric?.push({ kind: 'tick', time: player.currentTime, playing: player.playing });
    if (player.playing) pushMini();
  }, 500);

  // 三个窗口共用同一个 preload：方法一定在，但渲染层不该假设 —— 缺了就跳过，不能让挂载钩子抛。
  const offCmd = api.lyric?.onCmd?.((command) => runCommand(command));
  const offReady = api.lyric?.onWindowReady?.(() => pushTrack());
  const offMiniCmd = api.mini?.onCmd?.((command) => runCommand(command));
  // 迷你窗刚创建时会来要一次状态；不给它推，窗口里就只有"未在播放"
  const offMiniReq = api?.win?.onMiniRequestState?.(() => {
    pushTrack();
    pushMini();
  });

  const disposers: Array<() => void> = [stopSongWatch, stopOffsetWatch, () => clearInterval(timer)];
  if (offCmd) disposers.push(offCmd);
  if (offReady) disposers.push(offReady);
  if (offMiniCmd) disposers.push(offMiniCmd);
  if (offMiniReq) disposers.push(offMiniReq);

  return () => {
    for (const dispose of disposers) dispose();
    bridgeStarted = false;
    bridgeCtx = null;
  };
}

/** 桌面歌词窗开关（按钮状态 + 动作）。开起来后立刻推一包，不等窗口来要 */
export async function toggleDesktopLyric(): Promise<boolean> {
  const api = attachApi();
  if (!api?.lyric) return false;
  const open = await api.lyric.toggle().catch(() => false);
  if (open) pushLyricState();
  return Boolean(open);
}

export async function isDesktopLyricOpen(): Promise<boolean> {
  const api = attachApi();
  if (!api?.lyric) return false;
  return api.lyric.isOpen().catch(() => false);
}

/** 迷你模式开关。窗口开关走 api.win（enterMini/exitMini/isMini） */
export async function toggleMiniWindow(): Promise<boolean> {
  const api = attachApi();
  const win = api?.win;
  if (!win?.enterMini) return false;
  const isMini = await (win.isMini?.() ?? Promise.resolve(false)).catch(() => false);
  if (isMini) return (win.exitMini?.() ?? Promise.resolve(false)).catch(() => false);
  const ok = await win.enterMini().catch(() => false);
  // 进入后立刻推一次，不让迷你窗空着等下一个 500ms tick
  pushMiniState();
  return ok;
}
