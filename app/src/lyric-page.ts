/**
 * 桌面歌词窗的渲染脚本（S4）。原生 DOM —— 见 app/lyric.html 头部的说明。
 *
 * 数据契约（主窗口 → 这里）：
 *   { kind:'track', lines: {time,text}[], title, artist, offset }  —— 换歌/换偏移时整包重发
 *   { kind:'tick',  time, playing }                                —— 每 500ms 一次进度
 *   { kind:'state', playing, theme }
 * lines 里的 time **已经折算过 offset**（主窗口用 shiftLines 算好），
 * 所以这里只做二分，不再关心偏移 —— 两个窗口各算一遍必然漂。
 */
export interface LyricLine {
  time: number;
  text: string;
}

interface TrackPayload {
  kind: 'track';
  lines: LyricLine[];
  title: string;
  artist: string;
  offset: number;
}

interface TickPayload {
  kind: 'tick';
  time: number;
  playing: boolean;
}

interface StatePayload {
  kind: 'state';
  playing: boolean;
  theme: Record<string, string>;
}

type Payload = TrackPayload | TickPayload | StatePayload;

interface LyricPageApi {
  lyric: {
    onData(handler: (payload: Payload) => void): void;
    lock(locked: boolean): Promise<boolean>;
    close(): Promise<boolean>;
    cmd(command: string): void;
    request(): void;
  };
}

const api = (globalThis as unknown as { api?: LyricPageApi }).api;

const el = (id: string): HTMLElement | null => document.getElementById(id);
const activeEl = el('active');
const prevEl = el('prev');
const nextEl = el('next');

let lines: LyricLine[] = [];
let current = -1;
let locked = false;
/** 最近一次收到的数据（调试用：核对主窗口推来的 time 与行数） */
let lastPayload: { kind: string; time?: number; lines?: number } = { kind: 'none' };

const PLAY_SVG = '<polygon points="8,5 19,12 8,19"/>';
const PAUSE_SVG = '<rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/>';

/** 二分：最后一个 time <= seconds；都比它大则 -1（与 core/lyrics.ts 的 indexAt 同算法） */
export function indexAt(list: readonly LyricLine[], seconds: number): number {
  if (list.length === 0 || !Number.isFinite(seconds)) return -1;
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function paintEmpty(title: string): void {
  lines = [];
  current = -1;
  if (activeEl) activeEl.textContent = title || '网易云音乐 · 桌面歌词';
  if (prevEl) prevEl.textContent = '';
  if (nextEl) nextEl.textContent = '';
}

function paintIndex(index: number): void {
  if (index === current) return;
  current = index;
  if (activeEl) activeEl.textContent = index >= 0 ? lines[index].text : '♪';
  if (prevEl) prevEl.textContent = index > 0 ? lines[index - 1].text : '';
  if (nextEl) nextEl.textContent = index >= 0 && index + 1 < lines.length ? lines[index + 1].text : '';
}

function applyTheme(theme: Record<string, string> | undefined): void {
  if (!theme) return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme)) {
    if (name.startsWith('--') && typeof value === 'string') root.style.setProperty(name, value);
  }
}

function setPlaying(playing: boolean): void {
  const btn = el('btn-play');
  const icon = btn?.querySelector('svg');
  if (icon) icon.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  if (btn) btn.title = playing ? '暂停' : '播放';
}

function paintLock(): void {
  const btn = el('btn-lock');
  btn?.classList.toggle('on', locked);
  document.body.classList.toggle('locked', locked);
}

function handle(payload: Payload): void {
  lastPayload =
    payload.kind === 'track'
      ? { kind: 'track', lines: payload.lines.length }
      : payload.kind === 'tick'
        ? { kind: 'tick', time: payload.time }
        : { kind: 'state' };
  if (payload.kind === 'track') {
    applyTheme(undefined);
    if (!payload.lines.length) {
      paintEmpty(payload.title);
      return;
    }
    lines = payload.lines;
    current = -1;
    paintIndex(-1);
  } else if (payload.kind === 'tick') {
    setPlaying(payload.playing);
    if (lines.length === 0) return;
    paintIndex(indexAt(lines, payload.time));
  } else if (payload.kind === 'state') {
    setPlaying(payload.playing);
    applyTheme(payload.theme);
  }
}

function bind(): void {
  if (!api) {
    if (activeEl) activeEl.textContent = '歌词窗未接入 IPC';
    return;
  }
  api.lyric.onData(handle);
  el('btn-play')?.addEventListener('click', () => api.lyric.cmd('toggle'));
  el('btn-prev')?.addEventListener('click', () => api.lyric.cmd('prev'));
  el('btn-next')?.addEventListener('click', () => api.lyric.cmd('next'));
  el('btn-minus')?.addEventListener('click', () => api.lyric.cmd('offset-'));
  el('btn-plus')?.addEventListener('click', () => api.lyric.cmd('offset+'));
  el('btn-close')?.addEventListener('click', () => void api.lyric.close());
  el('btn-lock')?.addEventListener('click', () => {
    locked = !locked;
    paintLock();
    void api.lyric.lock(locked);
  });
  api.lyric.request();
}

/**
 * 只读调试钩子：歌词窗是独立窗口，出问题时只能靠它把内部状态取出来核对
 * （主窗口的歌词下标 vs 歌词窗的下标是否一致）。不写任何状态。
 */
(globalThis as unknown as { __lyricDebug?: () => unknown }).__lyricDebug = () => ({
  lines: lines.map((line) => line.time.toFixed(2) + ' ' + line.text),
  current,
  active: activeEl?.textContent ?? '',
  last: lastPayload,
});

bind();
