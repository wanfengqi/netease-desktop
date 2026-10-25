<script setup lang="ts">
/**
 * 新歌卡片（S5）：方形封面 + 歌名 + 歌手。
 *
 * 与 RecommendCard 分开的原因：这里的数据是 Song，副标题要显示歌手，
 * 点击语义是"播放第 i 首"（不是"打开详情"），角标也没有播放量可用。
 * 硬塞进一个组件会让 props 变成一堆互斥的 if。
 */
import type { Song } from '../data/normalize';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

defineProps<{
  song: Song;
  active?: boolean;
  playing?: boolean;
}>();

const emit = defineEmits<{ (e: 'play'): void }>();
</script>

<template>
  <button
    type="button"
    class="newsong-card"
    :class="{ 'is-active': active }"
    :title="song.name + ' — ' + (song.artistText || '未知歌手')"
    @click="emit('play')"
  >
    <div class="nc-cover" :class="{ 'no-copyright': song.vip }">
      <Cover :src="song.album.picUrl" :size="0" :radius="8" fallback-icon="music" />
      <span class="nc-play"><Icon name="play" :size="14" /></span>
    </div>
    <div class="nc-title s3-truncate">{{ song.name }}</div>
    <div class="nc-sub s3-truncate">{{ song.artistText || '未知歌手' }}</div>
  </button>
</template>

<style scoped>
.newsong-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  min-width: 0;
}

.nc-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  overflow: hidden;
}

.nc-cover :deep(.cover) {
  width: 100% !important;
  height: 100% !important;
}

.nc-play {
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

.newsong-card:hover .nc-play,
.newsong-card.is-active .nc-play {
  opacity: 1;
}

/* VIP 曲目右上角点一个半透明标记，不做假封面 */
.nc-cover.no-copyright::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  pointer-events: none;
}

.nc-title {
  font-size: 12px;
  color: var(--text-strong);
}

.newsong-card:hover .nc-title {
  color: var(--accent);
}

.newsong-card.is-active .nc-title {
  color: var(--accent);
}

.nc-sub {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
