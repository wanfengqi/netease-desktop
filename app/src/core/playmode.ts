/**
 * 播放模式（纯状态机 / 纯函数，零 DOM、零 Vue、零状态库依赖）。
 *
 * 全部语义逐字复刻旧版 src/renderer/player.js:76-95 —— 包括其中那些
 * "看起来像 bug、但确实是线上行为"的分支，不要按直觉"修正"：
 *
 *   pickNextIndex(auto)
 *     one   : 只有 auto=true（自然播完）才重复当前曲；
 *             手动 next 落到最后的 `(index+1)%n`，即真的往下一首走。
 *     order : 只有 auto=true 才 +1，到末尾返回 -1（调用方据此停止）；
 *             手动 next 落到 `(index+1)%n`，末尾会回绕到 0。
 *     shuffle: n===1 直接 0；否则随机，撞到自己就重试，最多 50 次。
 *     list  : `(index+1)%n`，永远循环。
 *
 *   pickPrevIndex()
 *     shuffle: 纯随机（历史回退由 Queue.popHistory 先负责，见 queue.ts）
 *     其它   : `(index-1+n)%n`
 */

export type PlayMode = 'list' | 'one' | 'shuffle' | 'order';

export interface PlayModeInfo {
  readonly id: PlayMode;
  /** 图标名，与旧版 Icons 注册表同名 */
  readonly icon: string;
  readonly label: string;
}

/** 顺序即 `cyclePlayMode` 的轮转顺序（旧版 PLAY_MODES） */
export const PLAY_MODES: readonly PlayModeInfo[] = [
  { id: 'list', icon: 'repeat', label: '列表循环' },
  { id: 'one', icon: 'repeatOne', label: '单曲循环' },
  { id: 'shuffle', icon: 'shuffle', label: '随机播放' },
  { id: 'order', icon: 'order', label: '顺序播放' },
];

/** shuffle 撞到自己时的重试上限（旧版硬编码 50，超出即认命返回当前 index） */
export const SHUFFLE_MAX_ATTEMPTS = 50;

/** 顺序播放到末尾、且没有下一首时约定的"停止"返回值 */
export const NO_INDEX = -1;

export function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === 'string' && PLAY_MODES.some((m) => m.id === value);
}

export function playModeInfo(mode: PlayMode): PlayModeInfo {
  return PLAY_MODES.find((m) => m.id === mode) ?? PLAY_MODES[0];
}

/** 轮转：list -> one -> shuffle -> order -> list */
export function nextPlayMode(mode: PlayMode): PlayMode {
  const i = PLAY_MODES.findIndex((m) => m.id === mode);
  return PLAY_MODES[(i + 1) % PLAY_MODES.length].id;
}

/**
 * 挑下一首的索引。返回 -1 表示"没有下一首"（只有 order + auto 到末尾会这样）。
 *
 * @param mode   当前播放模式
 * @param index  当前索引，队列尚未播放过时为 -1
 * @param length 队列长度
 * @param auto   true=歌曲自然播完触发；false=用户手点"下一首"
 * @param rng    随机源，注入以便测试（默认 Math.random，可被 spyOn 替换）
 */
export function pickNextIndex(
  mode: PlayMode,
  index: number,
  length: number,
  auto: boolean,
  rng: () => number = Math.random,
): number {
  if (length <= 0) return NO_INDEX;

  // 单曲循环只在自动续播时生效
  if (mode === 'one' && auto) return index;

  if (mode === 'shuffle') {
    if (length === 1) return 0;
    let picked = index;
    let guard = 0;
    do {
      picked = Math.floor(rng() * length);
      guard += 1;
    } while (picked === index && guard < SHUFFLE_MAX_ATTEMPTS);
    return picked;
  }

  // 顺序播放：自动续播到末尾即停
  if (mode === 'order' && auto) return index + 1 < length ? index + 1 : NO_INDEX;

  return (index + 1) % length;
}

/**
 * 挑上一首的索引。随机模式下这里只做"纯随机"，
 * 历史回退必须由调用方先用 Queue.popHistory() 尝试（旧版 prev() 的顺序）。
 */
export function pickPrevIndex(
  mode: PlayMode,
  index: number,
  length: number,
  rng: () => number = Math.random,
): number {
  if (length <= 0) return NO_INDEX;
  if (mode === 'shuffle') return Math.floor(rng() * length);
  return (index - 1 + length) % length;
}
