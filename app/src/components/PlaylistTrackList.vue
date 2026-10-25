<script setup lang="ts">
/**
 * 歌单内曲目列表（S6）—— 带拖拽排序与逐行移除。
 *
 * 为什么不复用 SongList/SongRow：那两个组件归 S4 那一路，本阶段不能改；
 * 而且这里需要 drag 手柄与删除按钮，混进通用行会污染搜索/专辑页的交互。
 *
 * 拖拽用原生 HTML5 dragstart/dragover/drop：
 *  · dragover 必须 preventDefault，否则 drop 不触发；
 *  · 拖动过程中用 dragIndex 显示插入位置，落点才 move，避免每帧都改数组。
 */
import { ref } from 'vue';
import type { Song } from '../data/normalize';
import { key as songKey } from '../data/normalize';
import { formatDuration } from '../stores/player';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    songs: readonly Song[];
    activeKey?: string;
    playing?: boolean;
    /** 只读模式：不显示拖拽手柄与删除按钮 */
    readonly?: boolean;
    emptyText?: string;
  }>(),
  { activeKey: '', playing: false, readonly: false, emptyText: '这个歌单还没有歌' },
);

const emit = defineEmits<{
  (e: 'play', index: number): void;
  (e: 'move', payload: { from: number; to: number }): void;
  (e: 'remove', payload: { index: number; song: Song }): void;
  (e: 'favorite', song: Song): void;
}>();

const dragIndex = ref(-1);
const overIndex = ref(-1);

function onDragStart(index: number, event: DragEvent): void {
  if (props.readonly) return;
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // Firefox/Chromium 都需要 setData 才会真的开始拖
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onDragOver(index: number, event: DragEvent): void {
  if (props.readonly || dragIndex.value < 0) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  overIndex.value = index;
}

function onDrop(index: number): void {
  if (props.readonly) return;
  const from = dragIndex.value;
  dragIndex.value = -1;
  overIndex.value = -1;
  if (from < 0 || from === index) return;
  emit('move', { from, to: index });
}

function onDragEnd(): void {
  dragIndex.value = -1;
  overIndex.value = -1;
}
</script>

<template>
  <section class="track-list">
    <div v-if="songs.length === 0" class="tl-empty">
      <Icon name="music" :size="24" />
      <p>{{ emptyText }}</p>
    </div>

    <template v-else>
      <header class="tl-head">
        <span class="tl-col-handle" />
        <span class="tl-col-index">#</span>
        <span class="tl-col-cover" />
        <span class="tl-col-main">标题</span>
        <span class="tl-col-album">专辑</span>
        <span class="tl-col-duration">时长</span>
        <span class="tl-col-ops" />
      </header>

      <div
        v-for="(song, i) in songs"
        :key="songKey(song) + '@' + i"
        class="tl-row"
        :class="{
          'is-active': activeKey !== '' && activeKey === songKey(song),
          'is-dragging': dragIndex === i,
          'is-over': overIndex === i && dragIndex !== i,
        }"
        :draggable="!readonly"
        role="button"
        tabindex="0"
        @click="emit('play', i)"
        @keydown.enter="emit('play', i)"
        @dragstart="onDragStart(i, $event)"
        @dragover="onDragOver(i, $event)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
      >
        <span v-if="!readonly" class="tl-handle" title="拖拽排序" aria-hidden="true">
          <Icon name="order" :size="13" />
        </span>
        <span v-else class="tl-col-handle" />

        <span class="tl-index">
          <span class="tl-num">{{ i + 1 }}</span>
          <span class="tl-play">
            <Icon :name="activeKey === songKey(song) && playing ? 'pause' : 'play'" :size="13" />
          </span>
        </span>

        <Cover :src="song.album.picUrl" :size="34" :radius="4" />
        <div class="tl-main">
          <div class="tl-name s3-truncate">{{ song.name || '未知歌曲' }}</div>
          <div class="tl-artist s3-truncate">{{ song.artistText || '未知歌手' }}</div>
        </div>
        <div class="tl-album s3-truncate">{{ song.album.name || '—' }}</div>
        <div class="tl-duration">{{ formatDuration(song.duration) }}</div>
        <div class="tl-ops">
          <button
            type="button"
            class="op-btn"
            title="收藏 / 取消收藏"
            data-testid="track-favorite"
            @click.stop="emit('favorite', song)"
          >
            <Icon name="album" :size="13" />
          </button>
          <button
            v-if="!readonly"
            type="button"
            class="op-btn op-danger"
            title="从歌单移除"
            data-testid="track-remove"
            @click.stop="emit('remove', { index: i, song })"
          >
            <Icon name="close" :size="13" />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.track-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 52px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.tl-empty p {
  margin: 0;
}

.tl-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px 8px;
  border-bottom: 1px solid var(--app-border);
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.tl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.tl-row:hover {
  background: var(--item-hover);
}

.tl-row.is-active {
  background: var(--item-active);
}

.tl-row.is-active .tl-name {
  color: var(--accent);
}

.tl-row.is-dragging {
  opacity: 0.4;
}

.tl-row.is-over {
  box-shadow: inset 0 2px 0 var(--accent);
}

.tl-handle {
  flex: 0 0 16px;
  width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  cursor: grab;
}

.tl-handle:active {
  cursor: grabbing;
}

.tl-col-handle {
  flex: 0 0 16px;
  width: 16px;
}

.tl-col-index,
.tl-index {
  flex: 0 0 20px;
  width: 20px;
  text-align: center;
}

.tl-index {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 18px;
}

.tl-num,
.tl-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.tl-play {
  opacity: 0;
  color: var(--text-strong);
}

.tl-row:hover .tl-num {
  opacity: 0;
}

.tl-row:hover .tl-play {
  opacity: 1;
}

.tl-row.is-active .tl-num {
  opacity: 0;
}

.tl-row.is-active .tl-play {
  opacity: 1;
  color: var(--accent);
}

.tl-col-cover {
  flex: 0 0 34px;
  width: 34px;
}

.tl-col-main,
.tl-main {
  flex: 1 1 40%;
  min-width: 0;
}

.tl-col-album,
.tl-album {
  flex: 0 1 26%;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.tl-col-duration,
.tl-duration {
  flex: 0 0 52px;
  text-align: right;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.tl-col-ops,
.tl-ops {
  flex: 0 0 56px;
  width: 56px;
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}

.tl-name {
  font-size: 13px;
  color: var(--text-strong);
}

.tl-artist {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.op-btn {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.tl-row:hover .op-btn {
  opacity: 1;
}

.op-btn:hover {
  background: var(--panel-hover);
  color: var(--text-strong);
}

.op-danger:hover {
  color: var(--accent);
}
</style>
