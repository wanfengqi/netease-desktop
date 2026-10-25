<script setup lang="ts">
/**
 * 歌曲行（S3）。
 *
 * 交互契约：
 *  · 整行单击 = 播放"这个列表里的这一首"（不是只播这一首 —— 否则队列永远是单曲）
 *  · hover 时左侧序号位换成播放/暂停图标（正在播的那首常驻显示状态）
 *  · 右键弹菜单：下一首播放 / 加入队列 / 复制歌名
 */
import { computed } from 'vue';
import type { Song } from '../data/normalize';
import { key } from '../data/normalize';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import { formatDuration } from '../stores/player';

const props = withDefaults(
  defineProps<{
    song: Song;
    index: number;
    /** 当前正在播的曲目 key（跨源唯一） */
    activeKey?: string;
    playing?: boolean;
    /** 是否显示专辑列 */
    showAlbum?: boolean;
  }>(),
  { activeKey: '', playing: false, showAlbum: true },
);

const emit = defineEmits<{
  (e: 'play', index: number): void;
  (e: 'context', payload: { song: Song; x: number; y: number }): void;
}>();

const active = computed(() => props.activeKey !== '' && props.activeKey === key(props.song));
const durationText = computed(() => formatDuration(props.song.duration));
const vip = computed(() => Boolean(props.song.vip));

function onContext(event: MouseEvent): void {
  emit('context', { song: props.song, x: event.clientX, y: event.clientY });
}
</script>

<template>
  <div
    class="row"
    :class="{ 'is-active': active }"
    role="button"
    tabindex="0"
    @click="emit('play', index)"
    @keydown.enter="emit('play', index)"
    @contextmenu.prevent="onContext"
  >
    <div class="row-index">
      <span class="row-num">{{ index + 1 }}</span>
      <span class="row-play">
        <Icon :name="active && playing ? 'pause' : 'play'" :size="14" />
      </span>
    </div>
    <Cover :src="song.album.picUrl" :size="36" :radius="4" />
    <div class="row-main">
      <div class="row-title s3-truncate">
        <span class="row-name">{{ song.name }}</span>
        <span v-if="vip" class="row-vip">VIP</span>
      </div>
      <div class="row-artist s3-truncate">{{ song.artistText || '未知歌手' }}</div>
    </div>
    <div v-if="showAlbum" class="row-album s3-truncate">{{ song.album.name || '—' }}</div>
    <div class="row-duration">{{ durationText }}</div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.row:hover {
  background: var(--item-hover);
}

.row.is-active {
  background: var(--item-active);
}

.row.is-active .row-name {
  color: var(--accent);
}

.row-index {
  position: relative;
  width: 24px;
  flex: 0 0 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.row-num,
.row-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.row-play {
  opacity: 0;
  color: var(--text-strong);
}

.row:hover .row-num {
  opacity: 0;
}

.row:hover .row-play {
  opacity: 1;
}

/* 正在播的那首：始终显示播放态图标，不看 hover */
.row.is-active .row-num {
  opacity: 0;
}

.row.is-active .row-play {
  opacity: 1;
  color: var(--accent);
}

.row-main {
  flex: 1 1 46%;
  min-width: 0;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-strong);
  font-size: 13px;
}

.row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-vip {
  flex: 0 0 auto;
  font-size: 9px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  border: 1px solid var(--accent);
  color: var(--accent);
}

.row-artist {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.row-album {
  flex: 0 1 30%;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.row-duration {
  flex: 0 0 52px;
  text-align: right;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
