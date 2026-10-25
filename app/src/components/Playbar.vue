<script setup lang="ts">
/**
 * 底部播放条（S3）。
 *
 * 约束 3：这里**不直接操作 <audio>**。所有动作都转发给 player store，
 * 由它转给 Player 协调层 —— 进度条也只是 emit → seekRatio。
 *
 * 进度条用自绘 div（不是 input[type=range]）：既好做"已播/已缓冲/总长"三段，
 * 又不用跟 Chromium 的原生滑杆样式打架。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { PLAY_MODES, playModeInfo } from '../core/playmode';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import { usePlayerStore } from '../stores/player';
import { useNavigationStore } from '../stores/navigation';
import { useToastStore } from '../stores/toast';

const player = usePlayerStore();
const nav = useNavigationStore();
const toast = useToastStore();
const windowBusy = ref(false);
/** 当前是否处于迷你模式（决定播放条按钮是进入还是退出） */
const miniActive = ref(false);
let offMiniExit: (() => void) | undefined;

const MODE_ICON = {
  list: 'repeat',
  one: 'repeatOne',
  shuffle: 'shuffle',
  order: 'order',
} as const;

const modeInfo = computed(() => playModeInfo(player.mode));
const modeIcon = computed(() => MODE_ICON[player.mode]);
/** 队列入口按钮角标：提示队列里有几首 */
const queueCount = computed(() => player.queueSongs.length);
const progressPercent = computed(() => Math.min(100, Math.max(0, player.progress * 100)));
const bufferedPercent = computed(() => {
  if (player.duration <= 0) return 0;
  return Math.min(100, Math.max(0, (player.buffered / player.duration) * 100));
});

const MODE_LABEL = PLAY_MODES.reduce<Record<string, string>>((acc, m) => {
  acc[m.id] = m.label;
  return acc;
}, {});

// ------------------------------------------------------------ 进度条拖动
const barRef = ref<HTMLDivElement | null>(null);
const dragging = ref(false);

function ratioFromEvent(event: MouseEvent): number {
  const el = barRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

function onBarDown(event: MouseEvent): void {
  if (!player.canPlay) return;
  dragging.value = true;
  player.seekRatio(ratioFromEvent(event));
  const onMove = (e: MouseEvent): void => {
    if (!dragging.value) return;
    player.seekRatio(ratioFromEvent(e));
  };
  const onUp = (): void => {
    dragging.value = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

const emit = defineEmits<{ (e: 'open-queue'): void }>();

function openPlayer(): void {
  nav.push({ name: 'player' });
}

async function toggleDesktopLyric(): Promise<void> {
  const toggle = (window.api as { lyric?: { toggle?: () => Promise<boolean> } }).lyric?.toggle;
  if (!toggle) {
    toast.push('当前环境不支持桌面歌词', 'warn');
    return;
  }
  try {
    await toggle();
  } catch {
    toast.push('桌面歌词窗口切换失败', 'warn');
  }
}

/**
 * 迷你模式是**切换**，不是单向进入。
 * 之前这里只调 enterMini，导致播放条按钮"只能进不能出"，
 * 用户只能靠迷你窗自己的按钮回来 —— 打包实测复现过。
 */
async function toggleMini(): Promise<void> {
  if (windowBusy.value) return;
  const api = window.api.win;
  if (!(api.enterMini || api.exitMini)) {
    toast.push('当前环境不支持迷你模式', 'warn');
    return;
  }
  windowBusy.value = true;
  try {
    if (miniActive.value) {
      const exited = await api.exitMini?.();
      if (exited === false) {
        toast.push('迷你模式未能退出', 'warn');
      } else {
        miniActive.value = false;
      }
    } else {
      const entered = await api.enterMini?.();
      if (entered) miniActive.value = true;
      else toast.push('迷你模式未能打开', 'warn');
    }
  } catch {
    toast.push(miniActive.value ? '迷你模式未能退出' : '迷你模式未能打开', 'warn');
  } finally {
    windowBusy.value = false;
    // 状态以主进程为准：迷你窗被系统/托盘关掉时本地 ref 不会自己变
    try {
      const real = await window.api.win.isMini?.();
      if (typeof real === 'boolean') miniActive.value = real;
    } catch {
      /* 非 Electron 环境保持原值 */
    }
  }
}

onMounted(() => {
  const api = window.api.win;
  offMiniExit = api.onMiniExit?.(() => { miniActive.value = false; });
  void api.isMini?.().then((real) => { if (typeof real === 'boolean') miniActive.value = real; }).catch(() => undefined);
});

onUnmounted(() => {
  offMiniExit?.();
});
</script>

<template>
  <footer class="playbar">
    <!-- 左：当前曲目 -->
    <div class="pb-left">
      <button v-if="player.song" type="button" class="pb-current" title="打开正在播放详情" @click="openPlayer">
        <Cover :src="player.song.album.picUrl" :size="46" :radius="6" />
        <span class="pb-meta">
          <span class="pb-title s3-truncate">{{ player.song.name }}</span>
          <span class="pb-artist s3-truncate">{{ player.song.artistText || '未知歌手' }}</span>
        </span>
      </button>
      <template v-else>
        <div class="pb-empty-cover">
          <Icon name="music" :size="20" />
        </div>
        <div class="pb-meta">
          <div class="pb-title">未在播放</div>
          <div class="pb-artist">搜索并点一首歌开始</div>
        </div>
      </template>
    </div>

    <!-- 中：控制 + 进度 -->
    <div class="pb-center">
      <div class="pb-controls">
        <button
          type="button"
          class="pb-btn"
          title="上一首"
          :disabled="!player.canPlay"
          @click="player.prev()"
        >
          <Icon name="prev" :size="16" />
        </button>
        <button
          type="button"
          class="pb-btn pb-btn-main"
          :title="player.playing ? '暂停' : '播放'"
          :disabled="!player.canPlay && queueCount === 0"
          @click="player.toggle()"
        >
          <Icon :name="player.playing ? 'pause' : 'play'" :size="18" />
        </button>
        <button
          type="button"
          class="pb-btn"
          title="下一首"
          :disabled="!player.canPlay"
          @click="player.next()"
        >
          <Icon name="next" :size="16" />
        </button>
      </div>

      <div class="pb-progress">
        <span class="pb-time">{{ player.percentLabel }}</span>
        <div
          ref="barRef"
          class="pb-bar"
          :class="{ 'is-disabled': !player.canPlay }"
          role="slider"
          :aria-valuenow="Math.round(progressPercent)"
          aria-valuemin="0"
          aria-valuemax="100"
          @mousedown.prevent="onBarDown"
        >
          <span class="pb-bar-buffer" :style="{ width: bufferedPercent + '%' }" />
          <span class="pb-bar-played" :style="{ width: progressPercent + '%' }">
            <span class="pb-bar-knob" />
          </span>
        </div>
        <span class="pb-time">{{ player.durationLabel }}</span>
      </div>
    </div>

    <!-- 右：音量 / 模式 / 队列 -->
    <div class="pb-right">
      <button type="button" class="pb-btn" :title="player.muted ? '取消静音' : '静音'" @click="player.toggleMute()">
        <Icon :name="player.muted ? 'mute' : 'volume'" :size="16" />
      </button>
      <input
        class="pb-volume"
        type="range"
        min="0"
        max="100"
        :value="Math.round(player.volume * 100)"
        aria-label="音量"
        @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
      />
      <button
        type="button"
        class="pb-btn pb-btn-mode"
        :class="{ 'is-on': player.mode !== 'list' }"
        :title="'播放模式：' + (MODE_LABEL[player.mode] ?? modeInfo.label)"
        @click="player.cycleMode()"
      >
        <Icon :name="modeIcon" :size="16" />
      </button>
      <button type="button" class="pb-btn" title="桌面歌词" @click="toggleDesktopLyric">
        <Icon name="album" :size="16" />
      </button>
      <button
        type="button"
        class="pb-btn"
        :class="{ 'pb-btn-active': miniActive }"
        :title="miniActive ? '退出迷你模式' : '迷你模式'"
        :disabled="windowBusy"
        @click="toggleMini"
      >
        <Icon name="square" :size="14" />
      </button>
      <button type="button" class="pb-btn pb-btn-queue" title="播放队列" @click="emit('open-queue')">
        <Icon name="queue" :size="16" />
        <span v-if="queueCount > 0" class="pb-badge">{{ queueCount }}</span>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.playbar {
  flex: 0 0 var(--playbar-h);
  height: var(--playbar-h);
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 18px;
  background: var(--sidebar-bg);
  border-top: 1px solid var(--app-border);
}

.pb-left {
  flex: 0 0 228px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pb-current {
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.pb-current:hover .pb-title {
  color: var(--accent);
}

.pb-empty-cover {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  border-radius: 6px;
  background: var(--panel-hover);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pb-meta {
  min-width: 0;
}

.pb-title {
  display: block;
  font-size: 13px;
  color: var(--text-strong);
}

.pb-artist {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.pb-center {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.pb-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pb-btn {
  border: 0;
  background: transparent;
  color: var(--text);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition: background 0.12s ease, color 0.12s ease;
}

.pb-btn:hover:not(:disabled) {
  background: var(--item-hover);
  color: var(--text-strong);
}

.pb-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* 切换型按钮的"已开启"态：迷你模式激活时要知道自己点下去是退出 */
.pb-btn-active {
  background: var(--accent-dim);
  color: var(--accent);
}

.pb-btn-main {
  width: 36px;
  height: 36px;
  background: var(--accent);
  color: var(--text-on-accent);
}

.pb-btn-main:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
  filter: brightness(1.12);
}

.pb-btn-mode.is-on {
  color: var(--accent);
}

.pb-badge {
  position: absolute;
  top: 1px;
  right: -1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pb-progress {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pb-time {
  flex: 0 0 38px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pb-bar {
  position: relative;
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--track-bg);
  cursor: pointer;
}

.pb-bar.is-disabled {
  cursor: default;
  opacity: 0.6;
}

.pb-bar-buffer {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
}

.pb-bar-played {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
}

.pb-bar-knob {
  position: absolute;
  right: -4px;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--text-strong);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.pb-bar:hover .pb-bar-knob {
  opacity: 1;
}

.pb-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.pb-volume {
  width: 84px;
  accent-color: var(--accent);
  cursor: pointer;
}
</style>
