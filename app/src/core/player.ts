/**
 * 播放协调层（S3）—— 把 AudioEngine + Queue + UrlResolver + repository 缝成一个播放器。
 *
 * 这一层存在的唯一理由：AudioEngine 是"给 url 就播"的纯执行器，Queue / PlayMode 是纯状态机，
 * UrlResolver 只负责取址竞态。它们各自都不该知道对方，协调责任全在这里。
 *
 * 四条必须守住的旧语义 / 修复（依据 docs/旧实现已知问题.md）：
 *  1. 取址必须走 UrlResolver 的 token 校验（修 2.1 "点 B 放 A"）：
 *     await 回来后 isCurrent(token) 为 false 的响应**直接丢弃**，绝不写进元素。
 *  2. prev() 无条件先吃历史栈，与播放模式无关（旧 1.3）。
 *  3. order 手动 next 到末尾回绕；one 手动 next 会走人；只有 auto 才自停/重复（旧 1.1 / 1.2）。
 *  4. 持久化不存索引，存「source:id」（修 2.6）：恢复时按 key 找位置，队列顺序变了也能定位。
 *
 * 还有两条：
 *  · clearQueue 一并清历史栈（旧 2.2 的残留索引问题）。
 *  · crossOrigin 由 AudioEngine 在设 src 之前处理，这里绝不碰元素。
 */
import {
  AudioEngine,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  defaultCrossOriginPolicy,
  type CrossOriginPolicy,
} from './audio';
import {
  NO_INDEX as QUEUE_NO_INDEX,
  clearQueue as clearQueueState,
  createQueue,
  current as currentSong,
  currentKey as currentQueueKey,
  isPlayableIndex,
  popHistory,
  removeAt as removeAtState,
  setQueue as setQueueState,
  visit,
  type QueueState,
} from './queue';
import {
  NO_INDEX as MODE_NO_INDEX,
  isPlayMode,
  nextPlayMode,
  pickNextIndex,
  pickPrevIndex,
  type PlayMode,
} from './playmode';
import { key, type Song, type SongKey } from '../data/normalize';
import { UrlResolver } from '../data/urlResolver';

/** 取址结果：url 为空时必须带原因，UI 才能提示"无版权 / VIP"而不是静默失败 */
export interface SongUrlInfo {
  url: string | null;
  reason?: string;
}

/** 取址实现（真实环境注入 repository，测试注入假数据） */
export type SongUrlFetcher = (song: Song) => Promise<SongUrlInfo>;

/** 播放失败的成因分类（旧 2.4：不能把一切都归成 CORS） */
export type PlayErrorKind = 'no-url' | 'network' | 'decode' | 'unsupported' | 'aborted' | 'unknown';

export interface PlayErrorInfo {
  kind: PlayErrorKind;
  message: string;
  /** media error code；0 表示不是元素报错（例如取址为空） */
  code: number;
  songKey: SongKey;
}

/** 一次播放尝试的可观测状态 */
export interface PlayerSnapshot {
  readonly queue: QueueState;
  readonly song: Song | null;
  readonly songKey: SongKey;
  readonly mode: PlayMode;
  readonly playing: boolean;
  readonly loading: boolean;
  /** 秒 */
  readonly currentTime: number;
  /** 秒；0 = 未知 */
  readonly duration: number;
  /** 秒；缓冲末端 */
  readonly buffered: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly lastError: PlayErrorInfo | null;
}

/** 落盘结构：**不含索引**，用 key 定位（修旧 2.6） */
export interface PersistedPlayerState {
  songs: Song[];
  currentKey: SongKey;
  mode: PlayMode;
  volume: number;
  muted: boolean;
}

export interface PlayerOptions {
  engine: AudioEngine;
  resolver?: UrlResolver;
  /** 取址实现；缺失时任何播放都会走"无地址"分支 */
  fetchUrl?: SongUrlFetcher;
  mode?: PlayMode;
  /** toast 出口；不传就静默（测试环境） */
  onToast?: (message: string) => void;
  /** 随机源，注入以便测试（默认 Math.random） */
  rng?: () => number;
  /** 单次取址超时 */
  resolveTimeoutMs?: number;
  /** 同一首歌因为"地址不可用"自动重试的次数上限（旧 2.4 要求有上限） */
  unsupportedRetryLimit?: number;
  crossOriginPolicy?: CrossOriginPolicy;
}

/** 歌曲自然播完（auto）与用户手点（manual）的区别，贯穿 next() */
type Trigger = 'auto' | 'manual';

const DEFAULT_UNSUPPORTED_RETRY_LIMIT = 1;

/** media error code → 成因（旧 2.4：code 4 说的是"地址/格式不可用"，不是必然 CORS） */
export function classifyMediaError(code: number): PlayErrorInfo | null {
  if (!code) return null;
  const base = { code, songKey: '' };
  switch (code) {
    case 1:
      return { ...base, kind: 'aborted', message: '播放被中断（切歌）' };
    case 2:
      return { ...base, kind: 'network', message: '网络中断，音频无法加载' };
    case 3:
      return { ...base, kind: 'decode', message: '音频解码失败（文件损坏或格式不支持）' };
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return { ...base, kind: 'unsupported', message: '地址不可用（格式不支持或链接已失效）' };
    default:
      return { ...base, kind: 'unknown', message: '播放失败（未知原因 ' + code + '）' };
  }
}

/**
 * 从"一串单曲"里按 key 找位置。找不到返回 -1 —— **绝不猜**（旧 2.6 就是拿索引硬套）。
 */
export function indexOfKey(songs: readonly Song[], songKey: SongKey): number {
  if (!songKey) return -1;
  for (let i = 0; i < songs.length; i += 1) {
    if (key(songs[i]) === songKey) return i;
  }
  return -1;
}

export class Player {
  private readonly engine: AudioEngine;

  private readonly resolver: UrlResolver;

  private readonly fetchUrl?: SongUrlFetcher;

  private readonly onToast?: (message: string) => void;

  private readonly rng: () => number;

  private readonly resolveTimeoutMs?: number;

  private readonly unsupportedRetryLimit: number;

  private readonly policy: CrossOriginPolicy;

  private readonly listeners = new Set<(snapshot: PlayerSnapshot) => void>();

  private readonly offs: Array<() => void> = [];

  private queue: QueueState = createQueue();

  private mode: PlayMode;

  private playing = false;

  private loading = false;

  private lastError: PlayErrorInfo | null = null;

  /** 本轮用户操作已经自动重试过几次（每次显式 playAt 归零） */
  private unsupportedRetries = 0;

  /** 最近一次取址失败的原因，供"无版权/VIP"提示使用 */
  private lastUrlReason = '';

  constructor(options: PlayerOptions) {
    this.engine = options.engine;
    this.resolver = options.resolver ?? new UrlResolver();
    this.fetchUrl = options.fetchUrl;
    this.onToast = options.onToast;
    this.rng = options.rng ?? Math.random;
    this.resolveTimeoutMs = options.resolveTimeoutMs;
    this.unsupportedRetryLimit = options.unsupportedRetryLimit ?? DEFAULT_UNSUPPORTED_RETRY_LIMIT;
    this.policy = options.crossOriginPolicy ?? defaultCrossOriginPolicy;
    this.mode = isPlayMode(options.mode) ? options.mode : 'list';
    this.bindEngine();
  }

  // ------------------------------------------------------------ 只读状态

  get snapshot(): PlayerSnapshot {
    const audio = this.engine.snapshot;
    const song = currentSong(this.queue);
    return {
      queue: this.queue,
      song,
      songKey: key(song),
      mode: this.mode,
      playing: this.playing,
      loading: this.loading,
      currentTime: audio.currentTime,
      duration: audio.duration,
      buffered: audio.bufferedEnd,
      volume: audio.volume,
      muted: audio.muted,
      lastError: this.lastError,
    };
  }

  get currentSong(): Song | null {
    return currentSong(this.queue);
  }

  get playMode(): PlayMode {
    return this.mode;
  }

  get songs(): readonly Song[] {
    return this.queue.items;
  }

  get currentIndex(): number {
    return this.queue.index;
  }

  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ------------------------------------------------------------ 队列

  /** 整表替换（换列表必须清历史，否则"上一首"会跳到别的列表） */
  setQueue(songs: readonly Song[], index: number = QUEUE_NO_INDEX): void {
    this.queue = setQueueState(songs, index >= 0 && index < songs.length ? index : QUEUE_NO_INDEX);
    this.emit();
  }

  addToQueue(song: Song): void {
    this.queue = { ...this.queue, items: [...this.queue.items, song] };
    this.emit();
  }

  /** "下一首播放"：插到当前曲之后（队列空时退化为 push 并把 index 拨到 0） */
  insertNext(song: Song): void {
    if (this.queue.items.length === 0 || this.queue.index < 0) {
      this.queue = {
        ...this.queue,
        items: [...this.queue.items, song],
        index: this.queue.index < 0 ? 0 : this.queue.index,
      };
    } else {
      const items = [...this.queue.items];
      items.splice(this.queue.index + 1, 0, song);
      this.queue = { ...this.queue, items };
    }
    this.emit();
  }

  async removeAt(i: number): Promise<void> {
    const before = this.queue.items.length;
    const result = removeAtState(this.queue, i);
    this.queue = result.state;
    this.emit();
    if (result.state.items.length === before) return; // 越界删除，什么都没发生
    if (result.playIndex !== QUEUE_NO_INDEX) {
      await this.playAt(result.playIndex, { keepHistory: true });
    } else {
      this.engine.reset();
      this.playing = false;
      this.emit();
    }
  }

  /** 清空队列 —— **并清历史栈**（旧 2.2 的残留索引问题） */
  clearQueue(): void {
    this.queue = clearQueueState();
    this.engine.reset();
    this.playing = false;
    this.emit();
  }

  // ------------------------------------------------------------ 播放

  /**
   * 播放第 index 首。**竞态保护的入口**：
   * 先更新索引 → 取址 → await 回来做 token 校验 → 校验通过才写元素。
   */
  async playAt(index: number, opts: { keepHistory?: boolean } = {}): Promise<void> {
    if (!isPlayableIndex(this.queue, index)) return;
    this.queue = visit(this.queue, index, { keepHistory: opts.keepHistory });
    this.unsupportedRetries = 0;
    await this.loadCurrent();
  }

  /** 用一批歌曲覆盖队列并从 index 开始播（搜索结果 / 歌单详情最常用） */
  async playList(songs: readonly Song[], index = 0): Promise<void> {
    this.setQueue(songs, index);
    await this.playAt(index);
  }

  /** 播单曲：已在队列里就定位过去，否则退化成"只播这一首" */
  async playSong(song: Song): Promise<void> {
    const at = indexOfKey(this.queue.items, key(song));
    if (at >= 0) {
      await this.playAt(at);
      return;
    }
    await this.playList([song], 0);
  }

  /** 播放/暂停切换（无音源时返回 false，交给调用方决定播哪首） */
  async toggle(): Promise<boolean> {
    if (!this.engine.hasSource) {
      if (!currentSong(this.queue)) return false;
      await this.loadCurrent();
      return true;
    }
    if (this.engine.snapshot.paused) {
      await this.engine.play();
      this.playing = true;
    } else {
      this.engine.pause();
      this.playing = false;
    }
    this.emit();
    return true;
  }

  async resume(): Promise<void> {
    if (!this.engine.hasSource) {
      await this.loadCurrent();
      return;
    }
    await this.engine.play();
    this.emit();
  }

  pause(): void {
    this.engine.pause();
    this.playing = false;
    this.emit();
  }

  /**
   * 下一首。auto=true（自然播完）才走"单曲重复 / 顺序到末尾停止"；
   * 手动点下一首时 order 回绕、one 走人（旧 1.1 / 1.2）。
   */
  async next(auto: boolean = false): Promise<void> {
    const trigger: Trigger = auto ? 'auto' : 'manual';
    const target = pickNextIndex(
      this.mode,
      this.queue.index,
      this.queue.items.length,
      trigger === 'auto',
      this.rng,
    );
    if (target === MODE_NO_INDEX) {
      // 只有 order + auto 会到这里：停止，但保留当前曲目
      this.engine.pause();
      this.playing = false;
      this.emit();
      return;
    }
    // **不传 keepHistory**：旧版 next() 调的是裸 playAt(i)，会把当前曲压进历史栈，
    // 于是"下一首 x3 再上一首 x3"能原路退回（旧 1.3）。
    // 只有 prev() 自身才是 keepHistory —— 它的目标来自栈，不该再入栈。
    await this.playAt(target);
  }

  /**
   * 上一首。**无条件优先弹历史栈**（旧 1.3：与播放模式无关），
   * 只有栈里没有可用项时才退回 pickPrevIndex。
   */
  async prev(): Promise<void> {
    const popped = popHistory(this.queue);
    this.queue = popped.state;
    if (popped.index !== QUEUE_NO_INDEX) {
      await this.playAt(popped.index, { keepHistory: true });
      return;
    }
    const current = this.queue.index;
    const target = pickPrevIndex(this.mode, current < 0 ? 0 : current, this.queue.items.length, this.rng);
    if (target === MODE_NO_INDEX) return;
    await this.playAt(target, { keepHistory: true });
  }

  /** 进度跳转（0-1） */
  seekRatio(ratio: number): void {
    this.engine.seekRatio(ratio);
    this.emit();
  }

  seek(seconds: number): void {
    this.engine.seek(seconds);
    this.emit();
  }

  setVolume(value: number): void {
    this.engine.setVolume(value);
    this.emit();
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted);
    this.emit();
  }

  setMode(mode: PlayMode): void {
    if (!isPlayMode(mode)) return;
    this.mode = mode;
    this.emit();
  }

  cycleMode(): PlayMode {
    this.mode = nextPlayMode(this.mode);
    this.emit();
    return this.mode;
  }

  // ------------------------------------------------------------ 持久化

  /** 落盘快照：队列存整首歌 + 当前曲的 key，**不存索引** */
  persist(): PersistedPlayerState {
    return {
      songs: [...this.queue.items],
      currentKey: currentQueueKey(this.queue),
      mode: this.mode,
      volume: this.engine.currentVolume,
      muted: this.engine.isMuted,
    };
  }

  /**
   * 恢复队列。index 一律由 key 反查（队列顺序变了也定位得准）。
   * @param overrideSongs 用一份新的歌曲序列替换落盘里的序列
   * @returns 是否定位到了当前曲
   */
  restore(state: PersistedPlayerState | null | undefined, overrideSongs?: readonly Song[]): boolean {
    if (!state || !Array.isArray(state.songs)) return false;
    const songs = overrideSongs ?? state.songs;
    const index = indexOfKey(songs, state.currentKey);
    this.queue = createQueue(songs, index);
    if (isPlayMode(state.mode)) this.mode = state.mode;
    if (Number.isFinite(state.volume)) this.engine.setVolume(state.volume);
    this.engine.setMuted(Boolean(state.muted));
    this.emit();
    return index >= 0;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.listeners.clear();
    this.engine.pause();
  }

  // ------------------------------------------------------------ 内部

  /** 装载当前队列曲目（playAt / toggle / prev / next 共用） */
  private async loadCurrent(): Promise<void> {
    const song = currentSong(this.queue);
    if (!song) return;

    this.loading = true;
    this.lastError = null;
    this.lastUrlReason = '';
    this.emit();

    const outcome = await this.resolveUrl(song);
    if (!outcome.ok) {
      this.loading = false;
      if (outcome.stale) {
        // 过期响应：什么都不做，等后发请求收尾（这就是"点 B 放 A"的修复点）
        this.emit();
        return;
      }
      this.failWithNoUrl(song, outcome.reason);
      return;
    }

    try {
      await this.engine.load(song, outcome.url);
      this.loading = false;
      this.playing = !this.engine.snapshot.paused;
      this.emit();
    } catch (error) {
      this.loading = false;
      this.reportError({
        kind: 'unknown',
        message: this.describePlayFailure(error),
        code: 0,
        songKey: key(song),
      });
    }
  }

  /** 取址 + token 校验；stale=true 表示这次响应已经过期，调用方必须静默丢弃 */
  private async resolveUrl(
    song: Song,
  ): Promise<{ ok: true; url: string } | { ok: false; stale: boolean; reason: string }> {
    if (!this.fetchUrl) {
      return { ok: false, stale: false, reason: '取址实现未接线' };
    }
    const fetcher = this.fetchUrl;
    const result = await this.resolver.resolve(song, {
      timeoutMs: this.resolveTimeoutMs,
      urlFor: async (s) => {
        const info = await fetcher(s);
        this.lastUrlReason = info.reason ?? '';
        return info.url;
      },
    });
    if (!this.resolver.isCurrent(result.token)) {
      return { ok: false, stale: true, reason: '过期请求（已切歌）' };
    }
    if (!result.url) {
      return { ok: false, stale: false, reason: this.lastUrlReason || result.error || '无可用播放地址' };
    }
    return { ok: true, url: result.url };
  }

  private failWithNoUrl(song: Song, reason: string): void {
    const message = '无法播放《' + song.name + '》：' + (reason || '无可用播放地址');
    this.reportError({ kind: 'no-url', message, code: 0, songKey: key(song) });
  }

  private reportError(info: PlayErrorInfo): void {
    this.lastError = info;
    this.playing = false;
    this.emit();
    if (info.kind !== 'aborted') this.onToast?.(info.message);
  }

  private describePlayFailure(error: unknown): string {
    if (error instanceof Error) {
      // 浏览器自动播放策略会给出 NotAllowedError —— 如实说明，别伪装成网络问题
      if (error.name === 'NotAllowedError') return '浏览器阻止了自动播放（需要用户手势）';
      return error.message;
    }
    return String(error);
  }

  private bindEngine(): void {
    this.offs.push(this.engine.subscribe('play', () => {
      this.playing = true;
      this.emit();
    }));
    this.offs.push(this.engine.subscribe('pause', () => {
      this.playing = false;
      this.emit();
    }));
    this.offs.push(this.engine.subscribe('timeupdate', () => this.emit()));
    this.offs.push(this.engine.subscribe('durationchange', () => this.emit()));
    this.offs.push(this.engine.subscribe('progress', () => this.emit()));
    this.offs.push(this.engine.subscribe('volumechange', () => this.emit()));
    this.offs.push(this.engine.subscribe('mutedchange', () => this.emit()));
    this.offs.push(this.engine.subscribe('ended', () => {
      this.playing = false;
      void this.next(true);
    }));
    this.offs.push(this.engine.subscribe('error', () => this.handleMediaError()));
  }

  /** 元素报错：区分成因 + 有上限的自愈（旧 2.4） */
  private handleMediaError(): void {
    const song = currentSong(this.queue);
    if (!song) return;
    const classified = classifyMediaError(this.engine.snapshot.errorCode);
    if (!classified) return;

    // 切歌途中冒出来的中断错误不是故障，静默
    if (classified.kind === 'aborted') return;

    const residue = this.hasCrossOriginResidue(song);
    if (classified.kind === 'unsupported' && this.unsupportedRetries < this.unsupportedRetryLimit) {
      this.unsupportedRetries += 1;
      // 只有"残留 crossOrigin"这一类才值得重来一次：真的坏 url 重试也没用
      if (residue) {
        this.engine.prepareCrossOrigin(song);
        this.onToast?.('已重置跨域设置，重新尝试播放');
        void this.loadCurrent();
        return;
      }
      this.reportError({
        ...classified,
        songKey: key(song),
        message: classified.message + '（已重试 ' + this.unsupportedRetries + ' 次，不再重试）',
      });
      return;
    }

    this.reportError({
      ...classified,
      songKey: key(song),
      message: classified.message + (residue ? '（疑似 crossOrigin 残留）' : ''),
    });
  }

  /** 音源要求"无 crossOrigin"，元素上却还挂着值 —— 旧 3.1 的双保险检查 */
  private hasCrossOriginResidue(song: Song): boolean {
    const el = this.engine.element;
    return this.policy(song) === null && el.crossOrigin !== null && el.crossOrigin !== '';
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot;
    for (const listener of Array.from(this.listeners)) listener(snapshot);
  }
}
