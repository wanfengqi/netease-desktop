<script setup lang="ts">
/**
 * 专辑详情（S3）：与歌单页同构，但少了"创建者"，多了发行日期。
 * 复用同一套 head/body 布局类，避免三份几乎相同的样式各写一遍。
 */
import { onMounted, ref, watch } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import SongList from '../components/SongList.vue';
import type { Album, Song } from '../data/normalize';
import { loadAlbumTracks } from '../data/source';
import { usePlayerStore } from '../stores/player';
import type { ContextMenuSelection } from '../types/ui';

const props = defineProps<{ album: Album }>();

const player = usePlayerStore();
const songs = ref<Song[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    songs.value = await loadAlbumTracks(props.album);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    songs.value = [];
  } finally {
    loading.value = false;
  }
}

async function play(index: number): Promise<void> {
  await player.playList(songs.value, index);
}

async function playAll(): Promise<void> {
  if (songs.value.length === 0) return;
  await player.playList(songs.value, 0);
}

function onContext(_payload: ContextMenuSelection): void {
  void _payload;
}

onMounted(load);
watch(() => props.album, load);
</script>

<template>
  <div class="detail-view">
    <header class="detail-head">
      <Cover :src="album.cover" :size="132" :radius="10" fallback-icon="album" />
      <div class="detail-meta">
        <div class="detail-kind">
          <Icon name="album" :size="13" />
          专辑 · {{ album.source === 'migu' ? '咪咕' : '网易云' }}
        </div>
        <h2 class="detail-title">{{ album.name }}</h2>
        <div class="detail-sub">
          <span v-if="album.date">发行 {{ album.date }}</span>
          <span v-if="album.size">{{ album.size }} 首</span>
        </div>
        <div class="detail-actions">
          <button type="button" class="btn-primary" :disabled="loading || songs.length === 0" @click="playAll">
            <Icon name="play" :size="14" />
            播放全部
          </button>
          <span class="detail-count">{{ songs.length }} 首可播</span>
        </div>
      </div>
    </header>

    <div class="detail-body">
      <SongList
        :songs="songs"
        :active-key="player.songKey"
        :playing="player.playing"
        :loading="loading"
        :error="error"
        empty-text="这张专辑没有曲目（或接口未返回）"
        :show-album="false"
        @play="play"
        @context="onContext"
      />
    </div>
  </div>
</template>

<style scoped>
.detail-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-head {
  flex: 0 0 auto;
  display: flex;
  gap: 18px;
  padding: 20px 24px 16px;
}

.detail-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.detail-kind {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.detail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.detail-sub {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}

.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 18px;
  border: 0;
  border-radius: 16px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 12px;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.detail-count {
  font-size: 11px;
  color: var(--text-muted);
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 20px;
}
</style>
