<script setup lang="ts">
/**
 * 横向卡片轨道（S5）：最近播放 / 每日推荐这类"一屏放不下"的区块用它。
 *
 * 用 overflow-x + scroll-snap 而不是轮播库：
 *  轮播需要定时器与可见性管理，还要处理"用户正在看时别自动翻"，
 *  对"打开就有东西看"这个目标来说是过度设计。横向滚动零状态、零定时器。
 */
import { computed } from 'vue';
import type { Song } from '../data/normalize';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    songs: readonly Song[];
    /** 当前播放曲的 key，用于高亮 */
    activeKey?: string;
    playing?: boolean;
  }>(),
  { activeKey: '', playing: false },
);

const emit = defineEmits<{ (e: 'play', index: number): void }>();

const items = computed(() => props.songs);
</script>

<template>
  <div class="rail">
    <button
      v-for="(song, i) in items"
      :key="song.source + ':' + String(song.id) + '@' + i"
      type="button"
      class="rail-card"
      :class="{ 'is-active': activeKey === song.source + ':' + String(song.id) }"
      @click="emit('play', i)"
    >
      <div class="rail-cover">
        <Cover :src="song.album.picUrl" :size="0" :radius="8" fallback-icon="music" />
        <span class="rail-play">
          <Icon :name="activeKey === song.source + ':' + String(song.id) && playing ? 'pause' : 'play'" :size="14" />
        </span>
      </div>
      <div class="rail-name s3-truncate">{{ song.name }}</div>
      <div class="rail-artist s3-truncate">{{ song.artistText || '未知歌手' }}</div>
    </button>
  </div>
</template>

<style scoped>
.rail {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 6px;
  scroll-snap-type: x proximity;
}

.rail-card {
  flex: 0 0 auto;
  width: 112px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  scroll-snap-align: start;
}

.rail-cover {
  position: relative;
  width: 112px;
  height: 112px;
  border-radius: 8px;
  overflow: hidden;
}

.rail-cover :deep(.cover) {
  width: 100% !important;
  height: 100% !important;
}

.rail-play {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--text-on-accent);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.rail-card:hover .rail-play,
.rail-card.is-active .rail-play {
  opacity: 1;
}

.rail-name {
  font-size: 12px;
  color: var(--text-strong);
}

.rail-card.is-active .rail-name {
  color: var(--accent);
}

.rail-artist {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
