<script setup lang="ts">
/**
 * 歌曲列表容器（S3）：表头 + 行 + 骨架屏 + 空态 + 错误态。
 *
 * 列表本身不持有播放状态以外的东西：播放动作通过 emit('play', index) 上抛，
 * 由页面决定"这批歌从哪来"（这样同一个组件能服务搜索/歌单/专辑/歌手四个页面）。
 */
import type { Song } from '../data/normalize';
import Icon from './Icon.vue';
import SongRow from './SongRow.vue';

withDefaults(
  defineProps<{
    songs: readonly Song[];
    activeKey?: string;
    playing?: boolean;
    loading?: boolean;
    error?: string;
    emptyText?: string;
    showAlbum?: boolean;
    /** 骨架屏行数 */
    skeletonRows?: number;
  }>(),
  {
    activeKey: '',
    playing: false,
    loading: false,
    error: '',
    emptyText: '这里还没有歌曲',
    showAlbum: true,
    skeletonRows: 8,
  },
);

const emit = defineEmits<{
  (e: 'play', index: number): void;
  (e: 'context', payload: { song: Song; x: number; y: number }): void;
}>();
</script>

<template>
  <section class="song-list">
    <header v-if="!loading && !error && songs.length > 0" class="list-head">
      <span class="col-index">#</span>
      <span class="col-cover" />
      <span class="col-main">标题</span>
      <span v-if="showAlbum" class="col-album">专辑</span>
      <span class="col-duration">时长</span>
    </header>

    <div v-if="loading" class="skeleton">
      <div v-for="i in skeletonRows" :key="i" class="skeleton-row">
        <span class="s3-skeleton sk-index" />
        <span class="s3-skeleton sk-cover" />
        <span class="skeleton-lines">
          <span class="s3-skeleton sk-line" />
          <span class="s3-skeleton sk-line sk-line-short" />
        </span>
      </div>
    </div>

    <div v-else-if="error" class="state state-error">
      <Icon name="music" :size="26" />
      <p>{{ error }}</p>
    </div>

    <div v-else-if="songs.length === 0" class="state">
      <Icon name="music" :size="26" />
      <p>{{ emptyText }}</p>
    </div>

    <div v-else class="rows">
      <SongRow
        v-for="(song, i) in songs"
        :key="song.source + ':' + String(song.id) + '@' + i"
        :song="song"
        :index="i"
        :active-key="activeKey"
        :playing="playing"
        :show-album="showAlbum"
        @play="emit('play', $event)"
        @context="emit('context', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.song-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.list-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px 8px;
  border-bottom: 1px solid var(--app-border);
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.col-index {
  width: 24px;
  flex: 0 0 24px;
  text-align: center;
}

.col-cover {
  width: 36px;
  flex: 0 0 36px;
}

.col-main {
  flex: 1 1 46%;
  min-width: 0;
}

.col-album {
  flex: 0 1 30%;
  min-width: 0;
}

.col-duration {
  flex: 0 0 52px;
  text-align: right;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.state p {
  margin: 0;
}

.state-error {
  color: var(--accent);
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 12px;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sk-index {
  width: 18px;
  height: 12px;
  flex: 0 0 18px;
}

.sk-cover {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 4px;
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sk-line {
  height: 10px;
  width: 38%;
}

.sk-line-short {
  width: 22%;
}
</style>
