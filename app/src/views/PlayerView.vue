<script setup lang="ts">
/**
 * 播放详情页（S4）—— 全屏"正在播放"。
 *
 * 设计取舍：
 *  · 左封面 / 右歌词的双栏布局，窄屏（<720px）自动变上下叠放；
 *  · 封面用 CSS 旋转唱片 + 呼吸光晕，不引任何动画库（约束 4 / 5）；
 *  · 相位切换（封面 ↔ 歌词）由本地 viewMode 控制，不写配置 —— 这是"这一眼想看什么"，
 *    不是跨会话偏好；
 *  · 自绘顶部拖拽带：标题栏区域可拖动窗口，**所有按钮显式 no-drag**（踩过的坑，见 TitleBar.vue）。
 *
 * 严格不碰 <audio>：一切播放动作走 player store。进度条拖动也只是 seekRatio。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import CommentsPanel from '../components/CommentsPanel.vue';
import Cover from '../components/Cover.vue';
import LyricsPanel from '../components/LyricsPanel.vue';
import { playModeInfo } from '../core/playmode';
import {
  isDesktopLyricOpen,
  startDesktopLyricBridge,
  toggleDesktopLyric,
  toggleMiniWindow,
  useLyricsStore,
} from '../stores/lyrics';
import { usePlayerStore } from '../stores/player';

const player = usePlayerStore();
const lyrics = useLyricsStore();

type Phase = 'cover' | 'lyrics';

const phase = ref<Phase>('cover');
const lyricOpen = ref(false);
const miniBusy = ref(false);
const offsetOpen = ref(false);
const commentsOpen = ref(false);

let stopBridge: (() => void) | null = null;

const MODE_ICON = {
  list: 'repeat',
  one: 'repeatOne',
  shuffle: 'shuffle',
  order: 'order',
} as const;

const song = computed(() => player.song);
const modeInfo = computed(() => playModeInfo(player.mode));
const modeIcon = computed(() => MODE_ICON[player.mode]);
const progressPercent = computed(() => Math.min(100, Math.max(0, player.progress * 100)));
const bufferedPercent = computed(() => {
  if (player.duration <= 0) return 0;
  return Math.min(100, Math.max(0, (player.buffered / player.duration) * 100));
});
const canSeek = computed(() => player.duration > 0);

/**
 * 当前歌词行。player.currentTime 由 store 每 500ms 刷一次，加上 timeupdate 的推送，
 * 足够跟住 LRC 的 10ms 级精度（人眼分辨不出 500ms 内的行切换）。
 */
const activeIndex = computed(() => {
  if (!lyrics.hasLyrics) return -1;
  return lyrics.indexAt(player.currentTime);
});

const albumName = computed(() => song.value?.album.name ?? '');
const coverUrl = computed(() => song.value?.album.picUrl ?? '');

// ------------------------------------------------------------ 交互
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
  if (!canSeek.value) return;
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

/** 点歌词行 → 跳到该行（目标时间已含偏移，见 core/lyrics.ts:seekTimeForLine） */
function onSeekLine(index: number): void {
  const target = lyrics.seekTargetFor(index);
  player.seekRatio(player.duration > 0 ? target / player.duration : 0);
}

function togglePhase(): void {
  phase.value = phase.value === 'cover' ? 'lyrics' : 'cover';
}

async function onToggleLyricWindow(): Promise<void> {
  const open = await toggleDesktopLyric();
  lyricOpen.value = open;
}

async function onToggleMini(): Promise<void> {
  if (miniBusy.value) return;
  miniBusy.value = true;
  try {
    await toggleMiniWindow();
  } finally {
    miniBusy.value = false;
  }
}

function nudgeOffset(delta: number): void {
  lyrics.nudgeOffset(delta);
}

// ------------------------------------------------------------ 生命周期
onMounted(async () => {
  stopBridge = startDesktopLyricBridge();
  lyricOpen.value = await isDesktopLyricOpen();
});

onBeforeUnmount(() => {
  stopBridge?.();
  stopBridge = null;
});

// 换歌时切回封面视图（歌词还没到，先给封面）
watch(
  () => player.songKey,
  () => {
    if (phase.value === 'lyrics' && !lyrics.hasLyrics) phase.value = 'cover';
  },
);
</script>

<template>
  <section class="player-view">
    <!-- 背景：模糊封面做底，没有封面时退回纯色 -->
    <div class="pv-bg" :style="coverUrl ? { backgroundImage: 'url(&quot;' + coverUrl + '&quot;)' } : undefined" />
    <div class="pv-bg-mask" />

    <!-- 自绘拖拽带：整条可拖；右侧按钮全部 no-drag（漏了会点不动） -->
    <header class="pv-head">
      <div class="pv-drag">
        <span class="pv-dot" />
        <span class="pv-head-title">正在播放</span>
        <span v-if="song" class="pv-head-sub s4-truncate">{{ song.name }} — {{ song.artistText }}</span>
      </div>
      <div class="pv-head-acts">
        <button v-if="song?.source === 'netease'" type="button" class="pv-btn" title="歌曲评论" @click="commentsOpen = true">
          <Icon name="queue" :size="14" />
          <span>评论</span>
        </button>
        <button
          type="button"
          class="pv-btn pv-btn-toggle"
          :class="{ 'is-on': phase === 'lyrics' }"
          :title="phase === 'cover' ? '看歌词' : '回到封面'"
          @click="togglePhase"
        >
          <Icon name="queue" :size="14" />
          <span>{{ phase === 'cover' ? '歌词' : '封面' }}</span>
        </button>
        <button
          type="button"
          class="pv-btn"
          :class="{ 'is-on': lyricOpen }"
          title="桌面歌词窗"
          @click="onToggleLyricWindow"
        >
          <Icon name="album" :size="14" />
          <span>桌面歌词</span>
        </button>
        <button type="button" class="pv-btn" title="迷你模式" :disabled="miniBusy" @click="onToggleMini">
          <Icon name="square" :size="12" />
          <span>迷你</span>
        </button>
      </div>
    </header>

    <!-- 主体 -->
    <div class="pv-main">
      <!-- 左：封面 / 歌词相位 -->
      <div class="pv-left" :class="{ 'is-lyrics': phase === 'lyrics' }">
        <template v-if="phase === 'cover'">
          <button type="button" class="pv-disc-wrap" title="点击查看歌词" @click="togglePhase">
            <span class="pv-glow" :class="{ 'is-spinning': player.playing }" />
            <span class="pv-disc" :class="{ 'is-spinning': player.playing }">
              <span class="pv-disc-groove" />
              <span class="pv-disc-label">
                <Cover :src="coverUrl" :size="118" :radius="59" />
              </span>
            </span>
            <span class="pv-needle" :class="{ 'is-playing': player.playing }" />
          </button>
        </template>
        <template v-else>
          <div class="pv-lyric-inline">
            <LyricsPanel
              :lines="lyrics.lines"
              :active-index="activeIndex"
              :plain-text="lyrics.plainText"
              :loading="lyrics.loading"
              :source-label="lyrics.sourceLabel"
              :error="lyrics.error"
              @seek="onSeekLine"
            />
          </div>
        </template>
      </div>

      <!-- 右：歌曲信息 + 歌词 -->
      <div class="pv-right" :class="{ 'is-hidden': phase === 'lyrics' }">
        <div class="pv-meta">
          <h1 class="pv-title s4-truncate">{{ song?.name ?? '未在播放' }}</h1>
          <div class="pv-artist s4-truncate">{{ song?.artistText || '—' }}</div>
          <div v-if="albumName" class="pv-album s4-truncate">专辑：{{ albumName }}</div>
        </div>

        <!-- 歌词相位时左栏已经是大歌词区，这里不再重复一份 -->
        <div v-if="phase === 'cover'" class="pv-lyric">
          <LyricsPanel
            :lines="lyrics.lines"
            :active-index="activeIndex"
            :plain-text="lyrics.plainText"
            :loading="lyrics.loading"
            :source-label="lyrics.sourceLabel"
            :error="lyrics.error"
            @seek="onSeekLine"
          />
        </div>
        <div v-else class="pv-hint">
          <div class="pv-hint-title">歌词视图</div>
          <div class="pv-hint-sub">点击左上「封面」回到唱片视图；点任意一句可跳到该处</div>
        </div>

        <!-- 时轴微调 -->
        <div class="pv-offset">
          <button
            type="button"
            class="pv-offset-btn"
            title="歌词提前 0.5 秒"
            @click="nudgeOffset(-0.5)"
          >
            −0.5s
          </button>
          <button
            type="button"
            class="pv-offset-label"
            :title="offsetOpen ? '收起时轴微调' : '展开时轴微调'"
            @click="offsetOpen = !offsetOpen"
          >
            时轴 {{ lyrics.offsetLabel }}
          </button>
          <button
            type="button"
            class="pv-offset-btn"
            title="歌词延后 0.5 秒"
            @click="nudgeOffset(0.5)"
          >
            +0.5s
          </button>
          <button
            v-if="offsetOpen"
            type="button"
            class="pv-offset-reset"
            title="归零"
            @click="lyrics.resetOffset()"
          >
            归零
          </button>
          <input
            v-if="offsetOpen"
            class="pv-offset-range"
            type="range"
            min="-10"
            max="10"
            step="0.1"
            :value="lyrics.offset"
            aria-label="歌词时轴偏移"
            @input="lyrics.setOffset(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
    </div>

    <!-- 进度条 + 控制 -->
    <footer class="pv-foot">
      <div class="pv-progress">
        <span class="pv-time">{{ player.percentLabel }}</span>
        <div
          ref="barRef"
          class="pv-bar"
          :class="{ 'is-disabled': !canSeek }"
          role="slider"
          :aria-valuenow="Math.round(progressPercent)"
          aria-valuemin="0"
          aria-valuemax="100"
          @mousedown.prevent="onBarDown"
        >
          <span class="pv-bar-buffer" :style="{ width: bufferedPercent + '%' }" />
          <span class="pv-bar-played" :style="{ width: progressPercent + '%' }">
            <span class="pv-bar-knob" />
          </span>
        </div>
        <span class="pv-time">{{ player.durationLabel }}</span>
      </div>

      <div class="pv-controls">
        <button
          type="button"
          class="pv-ctl"
          :class="{ 'is-on': player.mode !== 'list' }"
          :title="'播放模式：' + modeInfo.label"
          @click="player.cycleMode()"
        >
          <Icon :name="modeIcon" :size="17" />
        </button>
        <button type="button" class="pv-ctl" title="上一首" :disabled="!player.canPlay" @click="player.prev()">
          <Icon name="prev" :size="20" />
        </button>
        <button
          type="button"
          class="pv-ctl pv-ctl-main"
          :title="player.playing ? '暂停' : '播放'"
          :disabled="!player.canPlay && player.queueSongs.length === 0"
          @click="player.toggle()"
        >
          <Icon :name="player.playing ? 'pause' : 'play'" :size="22" />
        </button>
        <button type="button" class="pv-ctl" title="下一首" :disabled="!player.canPlay" @click="player.next()">
          <Icon name="next" :size="20" />
        </button>
        <div class="pv-volume">
          <button type="button" class="pv-ctl" :title="player.muted ? '取消静音' : '静音'" @click="player.toggleMute()">
            <Icon :name="player.muted ? 'mute' : 'volume'" :size="16" />
          </button>
          <input
            class="pv-volume-range"
            type="range"
            min="0"
            max="100"
            :value="Math.round(player.volume * 100)"
            aria-label="音量"
            @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
          />
        </div>
      </div>
    </footer>
    <CommentsPanel v-if="commentsOpen && song" :key="song.source + ':' + String(song.id)" :song="song" @close="commentsOpen = false" />
  </section>
</template>

<style scoped>
.player-view {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
}

/* 背景：封面放大模糊，做"沉浸式底"；无封面时保持 --app-bg */
.pv-bg {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  filter: blur(46px) saturate(1.15) brightness(0.5);
  opacity: 0.55;
  pointer-events: none;
  transform: scale(1.08);
}

.pv-bg-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, var(--overlay-veil), var(--app-bg) 78%);
  pointer-events: none;
}

/* ------------------------------------------------ 拖拽带 */
.pv-head {
  position: relative;
  z-index: 2;
  flex: 0 0 40px;
  height: 40px;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-bg) 70%, transparent);
  /* 整条可拖动窗口 */
  -webkit-app-region: drag;
}

.pv-drag {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  -webkit-app-region: drag;
  user-select: none;
}

.pv-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
  flex: 0 0 auto;
}

.pv-head-title {
  font-size: 12px;
  color: var(--text-strong);
  letter-spacing: 0.03em;
  flex: 0 0 auto;
}

.pv-head-sub {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 0;
}

.pv-head-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  /* 容器与每个按钮都声明 no-drag —— 双保险 */
  -webkit-app-region: no-drag;
}

.pv-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.pv-btn:hover:not(:disabled) {
  background: var(--panel-hover);
  color: var(--text-strong);
  border-color: var(--accent-dim);
}

.pv-btn.is-on {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: var(--accent);
}

.pv-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ------------------------------------------------ 主体 */
.pv-main {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 26px;
  padding: 22px 34px 6px;
  overflow: hidden;
}

.pv-left {
  flex: 0 0 40%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pv-left.is-lyrics {
  flex: 1;
  align-items: stretch;
}

.pv-lyric-inline {
  flex: 1;
  min-width: 0;
  display: flex;
}

/* ------------------------------------------------ 唱片 */
.pv-disc-wrap {
  position: relative;
  width: min(300px, 100%);
  aspect-ratio: 1;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pv-glow {
  position: absolute;
  inset: 6%;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-dim) 0%, transparent 68%);
  animation: pv-breathe 4.2s ease-in-out infinite;
}

.pv-disc {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, var(--disc-bg-core) 0%, var(--disc-bg-mid) 62%, var(--disc-bg-edge) 100%);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow-disc), inset 0 0 60px rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 唱片纹理：几道同心圆沟槽，纯 CSS 不引图片 */
.pv-disc-groove {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle at 50% 50%,
    var(--disc-groove) 0,
    var(--disc-groove) 1px,
    transparent 1px,
    transparent 6px
  );
}

.pv-disc-label {
  position: relative;
  width: 39%;
  aspect-ratio: 1;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.5), 0 6px 18px rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 中心孔 */
.pv-disc-label::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--disc-hole);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55);
}

.is-spinning {
  animation: pv-spin 22s linear infinite;
}

/* 播放臂：暂停时抬起来 */
.pv-needle {
  position: absolute;
  top: -4px;
  right: 8%;
  width: 3px;
  height: 42%;
  border-radius: 999px;
  background: linear-gradient(to bottom, var(--text-muted), var(--text));
  transform-origin: top center;
  transform: rotate(-24deg);
  transition: transform 0.5s cubic-bezier(0.34, 1.3, 0.64, 1);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
}

.pv-needle.is-playing {
  transform: rotate(-8deg);
}

@keyframes pv-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes pv-breathe {
  0%,
  100% {
    transform: scale(0.94);
    opacity: 0.55;
  }
  50% {
    transform: scale(1.06);
    opacity: 1;
  }
}

/* ------------------------------------------------ 右侧 */
.pv-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.pv-hint {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 10px 4px;
  color: var(--text-muted);
}

.pv-hint-title {
  font-size: 13px;
  color: var(--text-strong);
  font-weight: 600;
}

.pv-hint-sub {
  font-size: 11px;
  line-height: 1.6;
}

.pv-meta {
  flex: 0 0 auto;
}

.pv-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
  letter-spacing: 0.01em;
}

.pv-artist {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text);
}

.pv-album {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.pv-lyric {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* ------------------------------------------------ 时轴微调 */
.pv-offset {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid var(--app-border);
}

.pv-offset-btn,
.pv-offset-label,
.pv-offset-reset {
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--text);
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.pv-offset-label {
  color: var(--accent);
  border-color: var(--accent-dim);
  min-width: 74px;
  text-align: center;
}

.pv-offset-btn:hover,
.pv-offset-label:hover,
.pv-offset-reset:hover {
  background: var(--panel-hover);
  color: var(--text-strong);
}

.pv-offset-range {
  flex: 1 1 160px;
  min-width: 120px;
  accent-color: var(--accent);
}

/* ------------------------------------------------ 进度 + 控制 */
.pv-foot {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 34px 18px;
}

.pv-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pv-time {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
  width: 42px;
  text-align: center;
}

.pv-bar {
  position: relative;
  flex: 1;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.pv-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--track-bg);
}

.pv-bar.is-disabled {
  cursor: default;
  opacity: 0.55;
}

.pv-bar-buffer,
.pv-bar-played {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 999px;
}

.pv-bar-buffer {
  background: var(--track-buffer);
}

.pv-bar-played {
  background: var(--accent);
}

.pv-bar-knob {
  position: absolute;
  right: -5px;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.pv-bar:hover .pv-bar-knob {
  opacity: 1;
}

.pv-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.pv-ctl {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: var(--panel-bg);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.pv-ctl:hover:not(:disabled) {
  background: var(--panel-hover);
  color: var(--text-strong);
}

.pv-ctl:disabled {
  opacity: 0.45;
  cursor: default;
}

.pv-ctl.is-on {
  color: var(--accent);
}

.pv-ctl-main {
  width: 46px;
  height: 46px;
  background: var(--accent);
  color: var(--text-on-accent);
}

.pv-ctl-main:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.08);
  color: var(--text-on-accent);
}

.pv-volume {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 14px;
}

.pv-volume-range {
  width: 92px;
  accent-color: var(--accent);
}

/* ------------------------------------------------ 窄屏 */
@media (max-width: 720px) {
  .pv-main {
    flex-direction: column;
    gap: 12px;
    padding: 14px 18px 4px;
  }

  .pv-left {
    flex: 0 0 42%;
  }

  .pv-left.is-lyrics {
    flex: 1;
  }

  .pv-title {
    font-size: 19px;
  }

  .pv-foot {
    padding: 6px 18px 12px;
  }

  .pv-volume-range {
    width: 70px;
  }
}
</style>