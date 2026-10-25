/**
 * 播放 store（S3）—— core/player.ts 的响应式投影 + 持久化接线。
 *
 * 三条职责边界：
 *  1. **UI 绝不碰 <audio>**：一切播放控制经由这里转给 Player 协调层。
 *  2. Player 是队列与模式的**唯一所有者**；queue store 只是它的镜像视图，
 *     避免两套 index 各自漂移（那正是旧版最难查的一类 bug）。
 *  3. 落盘统一走 config store 的防抖通道（旧 2.5），且只存 key 不存索引（旧 2.6）。
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { AudioEngine } from '../core/audio';
import { Player, type PersistedPlayerState, type PlayerSnapshot } from '../core/player';
import type { PlayMode } from '../core/playmode';
import type { Song } from '../data/normalize';
import { resolveSongUrl } from '../data/source';
import { useConfigStore } from './config';
import { useToastStore } from './toast';

/** 把协调层快照拍平成 store 的 reactive 字段 */
function snapshotFields(snapshot: PlayerSnapshot) {
  return {
    song: snapshot.song,
    songKey: snapshot.songKey,
    mode: snapshot.mode,
    playing: snapshot.playing,
    loading: snapshot.loading,
    currentTime: snapshot.currentTime,
    duration: snapshot.duration,
    buffered: snapshot.buffered,
    volume: snapshot.volume,
    muted: snapshot.muted,
    lastError: snapshot.lastError,
    queueSongs: snapshot.queue.items.slice(),
    queueIndex: snapshot.queue.index,
    history: snapshot.queue.history.slice(),
  };
}

export const usePlayerStore = defineStore('player', () => {
  const config = useConfigStore();
  const toast = useToastStore();

  const ready = ref(false);
  const song = ref<Song | null>(null);
  const songKey = ref('');
  const mode = ref<PlayMode>('list');
  const playing = ref(false);
  const loading = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const buffered = ref(0);
  const volume = ref(0.8);
  const muted = ref(false);
  const lastError = ref<PlayerSnapshot['lastError']>(null);

  const queueSongs = ref<Song[]>([]);
  const queueIndex = ref(-1);
  const history = ref<number[]>([]);

  /** Player 不需要深层响应式（内部全是普通字段），shallowRef 避免无谓代理开销 */
  const player = shallowRef<Player | null>(null);
  let engine: AudioEngine | null = null;
  let unsubscribe: (() => void) | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  const progress = computed(() => (duration.value > 0 ? currentTime.value / duration.value : 0));
  const percentLabel = computed(() => formatTime(currentTime.value));
  const durationLabel = computed(() => formatTime(duration.value));
  const canPlay = computed(() => song.value !== null);

  function apply(snapshot: PlayerSnapshot): void {
    const fields = snapshotFields(snapshot);
    song.value = fields.song;
    songKey.value = fields.songKey;
    mode.value = fields.mode;
    playing.value = fields.playing;
    loading.value = fields.loading;
    currentTime.value = fields.currentTime;
    duration.value = fields.duration;
    buffered.value = fields.buffered;
    volume.value = fields.volume;
    muted.value = fields.muted;
    lastError.value = fields.lastError;
    queueSongs.value = fields.queueSongs;
    queueIndex.value = fields.queueIndex;
    history.value = fields.history;
  }

  /** 把播放器里真正在用的 <audio> 元素注入引擎（全应用只此一处） */
  function attach(audio: HTMLAudioElement): void {
    if (player.value) return;
    engine = new AudioEngine({ element: audio, initialVolume: config.volume });
    const instance = new Player({
      engine,
      fetchUrl: resolveSongUrl,
      mode: config.playMode,
      onToast: (message) => toast.push(message, 'warn'),
      resolveTimeoutMs: 12000,
    });
    player.value = instance;
    unsubscribe = instance.subscribe(apply);

    instance.setVolume(config.volume);
    instance.setMuted(config.muted);
    restoreFromConfig(instance);
    apply(instance.snapshot);
    ready.value = true;

    // timeupdate 之外再补一条低频轮询：Electron 里标签页不可见时 timeupdate 会变稀疏
    progressTimer = setInterval(() => {
      if (!player.value) return;
      const snapshot = player.value.snapshot;
      currentTime.value = snapshot.currentTime;
      duration.value = snapshot.duration;
    }, 500);
  }

  function restoreFromConfig(instance: Player): void {
    const songs = config.storedQueue;
    if (songs.length === 0) return;
    const state: PersistedPlayerState = {
      songs,
      currentKey: config.storedQueueKey,
      mode: config.playMode,
      volume: config.volume,
      muted: config.muted,
    };
    // 定位不到就只恢复列表、不预设当前曲 —— 绝不硬套旧索引（旧 2.6）
    instance.restore(state);
  }

  // ------------------------------------------------------------ 队列动作

  async function playAt(index: number): Promise<void> {
    await player.value?.playAt(index);
    persistQueue();
  }

  /** 播放"这批歌"里的第 index 首（搜索结果 / 歌单详情点击） */
  async function playList(list: readonly Song[], index = 0): Promise<void> {
    await player.value?.playList(list, index);
    persistQueue();
  }

  async function toggle(): Promise<void> {
    const instance = player.value;
    if (!instance) return;
    if (!song.value && queueSongs.value.length > 0) {
      await playAt(queueIndex.value >= 0 ? queueIndex.value : 0);
      return;
    }
    await instance.toggle();
  }

  async function next(auto = false): Promise<void> {
    await player.value?.next(auto);
    persistQueue();
  }

  async function prev(): Promise<void> {
    await player.value?.prev();
    persistQueue();
  }

  function seekRatio(ratio: number): void {
    player.value?.seekRatio(ratio);
  }

  function setVolume(value: number): void {
    player.value?.setVolume(value);
    config.setVolume(player.value?.snapshot.volume ?? value, player.value?.snapshot.muted ?? muted.value);
  }

  function toggleMute(): void {
    const instance = player.value;
    if (!instance) return;
    instance.setMuted(!instance.snapshot.muted);
    config.setVolume(instance.snapshot.volume, instance.snapshot.muted);
  }

  function cycleMode(): void {
    const next = player.value?.cycleMode();
    if (next) config.setPlayMode(next);
  }

  function addToQueue(target: Song): void {
    player.value?.addToQueue(target);
    persistQueue();
    toast.push('已加入播放队列');
  }

  function insertNext(target: Song): void {
    player.value?.insertNext(target);
    persistQueue();
    toast.push('已设为下一首播放');
  }

  async function removeAt(index: number): Promise<void> {
    await player.value?.removeAt(index);
    persistQueue();
  }

  function clearQueue(): void {
    player.value?.clearQueue();
    config.saveQueue([], '');
  }

  /** 队列 + 当前曲 key 一起去防抖写盘 */
  function persistQueue(): void {
    const instance = player.value;
    if (!instance) return;
    const state = instance.persist();
    config.saveQueue([...state.songs], state.currentKey);
  }

  function dispose(): void {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    unsubscribe?.();
    unsubscribe = null;
    player.value?.dispose();
    player.value = null;
    engine = null;
    ready.value = false;
  }

  return {
    ready,
    song,
    songKey,
    mode,
    playing,
    loading,
    currentTime,
    duration,
    buffered,
    volume,
    muted,
    lastError,
    queueSongs,
    queueIndex,
    history,
    progress,
    percentLabel,
    durationLabel,
    canPlay,
    player,
    attach,
    playAt,
    playList,
    toggle,
    next,
    prev,
    seekRatio,
    setVolume,
    toggleMute,
    cycleMode,
    addToQueue,
    insertNext,
    removeAt,
    clearQueue,
    persistQueue,
    dispose,
  };
});

/** 秒 → m:ss；无效时长返回 '--:--' */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** 毫秒 → m:ss（歌曲自带 duration 用） */
export function formatDuration(ms: number): string {
  return formatTime(ms / 1000);
}
