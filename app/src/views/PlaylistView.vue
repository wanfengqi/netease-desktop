<script setup lang="ts">
/**
 * 歌单详情（S3）：封面 / 标题 / 创建者 / 歌曲列表。
 *
 * 曲目在**进入视图时**才拉：搜索结果里的歌单条目只有封面与计数，
 * 提前把所有歌单的曲目都拉下来会一次性打爆接口。
 */
import { onMounted, ref, watch } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import SongList from '../components/SongList.vue';
import type { Song, Playlist } from '../data/normalize';
import type { ContextMenuSelection } from '../types/ui';
import { loadPlaylistTracks } from '../data/source';
import { usePlayerStore } from '../stores/player';

const props = defineProps<{ playlist: Playlist }>();

const player = usePlayerStore();
const songs = ref<Song[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    songs.value = await loadPlaylistTracks(props.playlist);
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

/** 播全部：把整张歌单压进队列，从第一首开始 */
async function playAll(): Promise<void> {
  if (songs.value.length === 0) return;
  await player.playList(songs.value, 0);
}

function onContext(_payload: ContextMenuSelection): void {
  void _payload;
}

onMounted(load);
watch(() => props.playlist, load);
</script>

<template>
  <div class="detail-view">
    <header class="detail-head">
      <Cover :src="playlist.cover" :size="132" :radius="10" fallback-icon="album" />
      <div class="detail-meta">
        <div class="detail-kind">
          <Icon name="album" :size="13" />
          歌单 · {{ playlist.source === 'migu' ? '咪咕' : '网易云' }}
        </div>
        <h2 class="detail-title">{{ playlist.name }}</h2>
        <div class="detail-sub">
          <span v-if="playlist.creator">创建者：{{ playlist.creator }}</span>
          <span>{{ playlist.count }} 首</span>
          <span v-if="playlist.playCount">播放 {{ playlist.playCount }}</span>
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
        empty-text="这个歌单没有曲目（或接口未返回）"
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
