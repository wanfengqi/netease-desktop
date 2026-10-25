/**
 * 音频引擎：`HTMLAudioElement` 的封装。
 *
 * 视图层以后**永不直接碰 <audio>**（旧版 player.js 里 30+ 处 document.getElementById('audio')
 * 散落在取址、进度、音量、均衡器、媒体会话里，是这轮重构要拆掉的东西）。
 *
 * 三个硬约束：
 *  1. 元素由**构造参数注入**，模块内不做 `document.getElementById`，也不在 import
 *     期碰 window —— 单测传一个假元素即可跑，不需要 jsdom。
 *  2. 播放前顺序必须是 `prepareCrossOrigin(song)` → `src` → `volume` → `play()`。
 *     旧版注释写得很直白："request 已发出、改 crossOrigin 无效"，
 *     且咪咕源挂 anonymous 会被判成 CORS 失败而完全哑音。
 *  3. 快速切歌产生的 AbortError 不是故障（旧版 isPlayAbort），必须静默吞掉。
 */
import type { Song } from '../data/normalize';

/** `<audio>` 上我们真正用到的那一小撮成员，便于测试替身。 */
export interface AudioElementLike {
  src: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  crossOrigin: string | null;
  readonly error?: MediaErrorLike | null;
  readonly buffered?: TimeRangesLike;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute?(name: string): void;
}

export interface MediaErrorLike {
  readonly code: number;
}

export interface TimeRangesLike {
  readonly length: number;
  end(index: number): number;
}

/** 元素上真会变的事件（`volumechange`/`mutedchange` 是本地合成的，见 setVolume/setMuted）。 */
export type AudioEventName =
  | 'play'
  | 'pause'
  | 'ended'
  | 'timeupdate'
  | 'durationchange'
  | 'progress'
  | 'volumechange'
  | 'mutedchange'
  | 'error';

export type AudioEventListener = (snapshot: AudioSnapshot) => void;

export interface AudioSnapshot {
  readonly paused: boolean;
  /** 秒；无有效时长时为 0 */
  readonly currentTime: number;
  /** 秒；无有效时长时为 0 */
  readonly duration: number;
  /** 秒；缓冲区间末端（没有 buffered 时为 0） */
  readonly bufferedEnd: number;
  readonly volume: number;
  readonly muted: boolean;
  /** 是否已有 src */
  readonly hasSource: boolean;
  /** 最近一次 media error 的 code（0 = 无） */
  readonly errorCode: number;
}

/**
 * 决定某首歌播放前把 crossOrigin 设成什么。
 * 默认策略直接照抄旧版 G0 实测结论（src/renderer/player.js:326-336）：
 *   网易云 ACAO:* + ACAC:true → 'anonymous' 可用；
 *   咪咕无任何 Access-Control-* 头 → 必须 null，否则 MEDIA_ERR_SRC_NOT_SUPPORTED 哑音。
 * S2 接均衡器时替换成"仅当均衡器开启且非咪咕才 anonymous"即可，接口不变。
 */
export type CrossOriginPolicy = (song: Song | null) => string | null;

export const defaultCrossOriginPolicy: CrossOriginPolicy = (song) =>
  song && song.source !== 'migu' ? 'anonymous' : null;

export interface AudioEngineOptions {
  element: AudioElementLike;
  crossOriginPolicy?: CrossOriginPolicy;
  initialVolume?: number;
  initialMuted?: boolean;
}

export interface LoadOptions {
  /** 默认 true（旧版 playAt 设完 src 就播放） */
  autoplay?: boolean;
}

/** 引擎会派发的全部事件名（顺序即 subscribeAll 的订阅顺序） */
const AUDIO_EVENTS: readonly AudioEventName[] = [
  'play',
  'pause',
  'ended',
  'timeupdate',
  'durationchange',
  'progress',
  'volumechange',
  'mutedchange',
  'error',
];

const MIN_VOLUME = 0;
const MAX_VOLUME = 1;
/** MEDIA_ERR_SRC_NOT_SUPPORTED —— 旧版拿它判定"跨域音频拿不到"并回退裸播放 */
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return MAX_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, value));
}

/**
 * 该错误是否属于"切歌副作用"而不是真故障。
 * 旧版 isPlayAbort：快速切歌时旧 play() promise 被打断抛 AbortError，
 * 弹提示只会吓到用户。注意 null/undefined 也算（旧版 `if (!e) return true`）。
 */
export function isPlayAbortError(error: unknown): boolean {
  if (!error) return true;
  if (typeof error === 'object') {
    const maybe = error as { name?: unknown; message?: unknown };
    if (maybe.name === 'AbortError') return true;
    if (typeof maybe.message === 'string' && /interrupted|abort/i.test(maybe.message)) return true;
  }
  return false;
}

export class AudioEngine {
  private readonly el: AudioElementLike;

  private readonly policy: CrossOriginPolicy;

  private readonly listeners = new Map<AudioEventName, Set<AudioEventListener>>();

  private readonly boundHandlers: Array<{ type: string; handler: () => void }> = [];

  private disposed = false;

  /** 引擎自己记住的音量：换歌时按固定顺序重放，避免沿用上一首的旧值 */
  private volume: number;

  private muted: boolean;

  constructor(options: AudioEngineOptions) {
    this.el = options.element;
    this.policy = options.crossOriginPolicy ?? defaultCrossOriginPolicy;
    this.volume = clampVolume(options.initialVolume ?? options.element.volume);
    this.muted = options.initialMuted ?? false;
    this.el.volume = this.volume;
    this.el.muted = this.muted;
    this.bindElementEvents();
  }

  /** 底层元素只读暴露（均衡器/媒体会话等需要直接接线的场景用）。 */
  get element(): AudioElementLike {
    return this.el;
  }

  /** 是否已有音源（对应旧版 `if (!a.src)` 判断）。 */
  get hasSource(): boolean {
    return this.el.src !== '';
  }

  get snapshot(): AudioSnapshot {
    return {
      paused: this.el.paused,
      currentTime: this.validTime(this.el.currentTime),
      duration: this.validDuration(),
      bufferedEnd: this.bufferedEnd(),
      volume: this.el.volume,
      muted: this.el.muted,
      hasSource: this.hasSource,
      errorCode: this.el.error?.code ?? 0,
    };
  }

  /**
   * 播放某首歌之前必须调它 —— 在设 src **之前**把 crossOrigin 定下来。
   * 顺序错了就白设：src 一写，请求已经发出，属性改动不再生效。
   */
  prepareCrossOrigin(song: Song | null): void {
    const want = this.policy(song);
    if (want === null) {
      // 旧版连 removeAttribute('crossorigin') 一起做，避免属性残留
      if (typeof this.el.removeAttribute === 'function') {
        try {
          this.el.removeAttribute('crossorigin');
        } catch {
          // 测试替身不实现 removeAttribute 也无所谓
        }
      }
      this.el.crossOrigin = null;
      return;
    }
    this.el.crossOrigin = want;
  }

  /**
   * 装载一首歌并（默认）开始播放。**顺序即契约**：
   *   prepareCrossOrigin → src → volume → play()
   * 反过来的话 crossOrigin 失效（旧版踩过），或者音量用着上一首的旧值。
   *
   * @throws 播放被拒绝且不是 AbortError 时抛出，交由调用方决定是否提示
   */
  async load(song: Song | null, url: string, opts: LoadOptions = {}): Promise<void> {
    this.prepareCrossOrigin(song); // 1. 必须在 src 之前
    this.el.src = url; // 2. 再设源
    this.el.volume = this.volume; // 3. 重放音量（新 src 会重置元素状态）
    this.el.muted = this.muted;
    if (opts.autoplay === false) return;
    await this.play(); // 4. 最后播放
  }

  /** 播放当前 src。AbortError 静默；其它错误向调用方抛出。 */
  async play(): Promise<void> {
    try {
      const result: unknown = this.el.play();
      if (result && typeof (result as Promise<void>).then === 'function') {
        await (result as Promise<void>);
      }
    } catch (error) {
      if (isPlayAbortError(error)) return;
      throw error;
    }
  }

  pause(): void {
    this.el.pause();
  }

  /**
   * 无 src 时播放：旧版是"从队列第一首开始"，这部分属于队列逻辑，
   * 内核这里只回报 false 让上层去决定播哪首。
   */
  toggle(): boolean {
    if (!this.hasSource) return false;
    if (this.el.paused) {
      void this.play();
    } else {
      this.pause();
    }
    return true;
  }

  /** 绝对定位到第 seconds 秒（自动夹到 [0, duration]）。 */
  seek(seconds: number): void {
    const duration = this.validDuration();
    if (duration <= 0 || !Number.isFinite(seconds)) return;
    this.el.currentTime = Math.min(duration, Math.max(0, seconds));
  }

  /** 按比例定位 —— 旧版 seekRatio：时长无效时**什么都不做**（不是跳到 0）。 */
  seekRatio(ratio: number): void {
    const duration = this.validDuration();
    if (duration <= 0 || !Number.isFinite(ratio)) return;
    this.el.currentTime = Math.min(duration, Math.max(0, ratio) * duration);
  }

  /**
   * 设音量并夹到 [0,1]。旧版语义：把音量从 0 拉起来时会连带取消静音
   * （不然用户会以为滑杆坏了）。
   */
  setVolume(value: number): void {
    this.volume = clampVolume(value);
    this.el.volume = this.volume;
    if (this.volume > 0 && this.muted) {
      this.muted = false;
      this.el.muted = false;
      this.emit('mutedchange');
    }
    this.emit('volumechange');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.el.muted = muted;
    this.emit('mutedchange');
    this.emit('volumechange');
  }

  get currentVolume(): number {
    return this.volume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 取址失败时统一走这里：清掉 src，避免下次 toggle 拿旧地址继续播。 */
  reset(): void {
    this.pause();
    this.el.src = '';
  }

  subscribe(event: AudioEventName, listener: AudioEventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /** 一次订阅全部事件（UI 只想要"变了就刷新"时用） */
  subscribeAll(listener: AudioEventListener): () => void {
    const offs = AUDIO_EVENTS.map((name) => this.subscribe(name, listener));
    return () => offs.forEach((off) => off());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { type, handler } of this.boundHandlers) {
      this.el.removeEventListener(type, handler);
    }
    this.boundHandlers.length = 0;
    this.listeners.clear();
  }

  private emit(event: AudioEventName): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    const snapshot = this.snapshot;
    for (const listener of Array.from(set)) listener(snapshot);
  }

  private bindElementEvents(): void {
    const types = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'progress', 'error'];
    for (const type of types) {
      const handler = (): void => this.emit(type as AudioEventName);
      this.el.addEventListener(type, handler);
      this.boundHandlers.push({ type, handler });
    }
  }

  private validDuration(): number {
    const { duration } = this.el;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  private validTime(time: number): number {
    return Number.isFinite(time) && time > 0 ? time : 0;
  }

  private bufferedEnd(): number {
    const { buffered } = this.el;
    if (!buffered || buffered.length === 0) return 0;
    try {
      const end = buffered.end(buffered.length - 1);
      return Number.isFinite(end) ? end : 0;
    } catch {
      return 0;
    }
  }
}
