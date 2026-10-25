<script setup lang="ts">
/**
 * 歌手主页（S3）：简介 + 歌曲 tab + 专辑 tab。
 *
 * 两个 tab 的数据一次拉全（loadArtist 内部并发），切 tab 不重发请求。
 */
import { computed, onMounted, ref, watch } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import SongList from '../components/SongList.vue';
import type { Album, Artist, Song } from '../data/normalize';
import { loadArtist } from '../data/source';
import { useNavigationStore } from '../stores/navigation';
import { usePlayerStore } from '../stores/player';

const props = defineProps<{ artist: Artist }>();

const player = usePlayerStore();
const nav = useNavigationStore();

const detail = ref<Artist>(props.artist);
const songs = ref<Song[]>([]);
const albums = ref<Album[]>([]);
const loading = ref(true);
const error = ref('');
const tab = ref<'songs' | 'albums'>('songs');

const brief = computed(() => detail.value.brief || '暂无简介');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await loadArtist(props.artist);
    detail.value = result.artist;
    songs.value = result.songs;
    albums.value = result.albums;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    songs.value = [];
    albums.value = [];
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

onMounted(load);
watch(() => props.artist, () => {
  detail.value = props.artist;
  void load();
});
</script>

<template>
  <div class="artist-view">
    <header class="ar-head">
      <Cover :src="detail.avatar" :size="112" :radius="56" fallback-icon="artist" />
      <div class="ar-meta">
        <div class="ar-kind">
          <Icon name="artist" :size="13" />
          歌手 · {{ detail.source === 'migu' ? '咪咕' : '网易云' }}
        </div>
        <h2 class="ar-name">{{ detail.name }}</h2>
        <div class="ar-sub">
          <span>{{ detail.songNum }} 首</span>
          <span>{{ detail.albumNum }} 张专辑</span>
        </div>
        <p class="ar-brief">{{ brief }}</p>
      </div>
    </header>

    <div class="ar-tabs">
      <button type="button" class="ar-tab" :class="{ 'is-active': tab === 'songs' }" @click="tab = 'songs'">
        歌曲 <span class="ar-tab-count">{{ songs.length }}</span>
      </button>
      <button type="button" class="ar-tab" :class="{ 'is-active': tab === 'albums' }" @click="tab = 'albums'">
        专辑 <span class="ar-tab-count">{{ albums.length }}</span>
      </button>
      <button
        v-if="tab === 'songs'"
        type="button"
        class="btn-primary ar-play-all"
        :disabled="loading || songs.length === 0"
        @click="playAll"
      >
        <Icon name="play" :size="13" />
        播放全部
      </button>
    </div>

    <div class="ar-body">
      <div v-if="error" class="ar-error">{{ error }}</div>

      <SongList
        v-if="tab === 'songs'"
        :songs="songs"
        :active-key="player.songKey"
        :playing="player.playing"
        :loading="loading"
        :error="error"
        empty-text="这位歌手没有可播歌曲"
        @play="play"
      />

      <div v-else class="grid">
        <template v-if="loading">
          <div v-for="i in 6" :key="i" class="grid-card">
            <span class="s3-skeleton grid-cover" />
            <span class="s3-skeleton grid-line" />
          </div>
        </template>
        <div v-else-if="albums.length === 0" class="ar-empty">没有查到专辑</div>
        <button
          v-for="al in albums"
          :key="al.source + ':' + String(al.id)"
          type="button"
          class="grid-card"
          @click="nav.openAlbum(al)"
        >
          <Cover :src="al.cover" :size="132" :radius="8" fallback-icon="album" />
          <div class="grid-name s3-truncate">{{ al.name }}</div>
          <div class="grid-sub s3-truncate">{{ al.date || '发行日期未知' }}</div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.artist-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ar-head {
  flex: 0 0 auto;
  display: flex;
  gap: 18px;
  padding: 20px 24px 14px;
}

.ar-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
}

.ar-kind {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.ar-name {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-strong);
}

.ar-sub {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.ar-brief {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ar-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 24px;
  border-bottom: 1px solid var(--app-border);
}

.ar-tab {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  padding: 9px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.ar-tab.is-active {
  color: var(--text-strong);
  border-bottom-color: var(--accent);
}

.ar-tab-count {
  margin-left: 4px;
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.ar-play-all {
  margin-left: auto;
}

.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 12px;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.ar-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 24px 20px;
}

.ar-error {
  margin-bottom: 10px;
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 12px;
}

.ar-empty {
  grid-column: 1 / -1;
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px 14px;
}

.grid-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.grid-card :deep(.cover) {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
}

.grid-card:hover .grid-name {
  color: var(--accent);
}

.grid-name {
  font-size: 12px;
  color: var(--text-strong);
}

.grid-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.grid-line {
  height: 11px;
  width: 72%;
}

.s3-skeleton.grid-cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
}
</style>
