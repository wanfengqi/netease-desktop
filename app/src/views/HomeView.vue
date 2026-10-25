<script setup lang="ts">
/**
 * 首页（S3）：最近播放 + 推荐歌单入口。
 *
 * 这里刻意只做"能点的东西"：S4 才接推荐流。当前对端到端验收的作用是
 * 给用户一个"应用是活的"的落点，并且能一键回到上次的队列。
 */
import { computed, onMounted, ref } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import SongList from '../components/SongList.vue';
import type { Playlist, Song } from '../data/normalize';
import { netease } from '../data/repository/index';
import { useConfigStore } from '../stores/config';
import { useNavigationStore } from '../stores/navigation';
import { usePlayerStore } from '../stores/player';

const player = usePlayerStore();
const config = useConfigStore();
const nav = useNavigationStore();

const playlists = ref<Playlist[]>([]);
const loading = ref(true);
const error = ref('');

const recent = computed<readonly Song[]>(() => config.recent.slice(0, 8));

/** 续播上次的队列：不算"新播放"，只是把队列恢复到可播状态 */
async function resume(): Promise<void> {
  if (player.queueSongs.length === 0) return;
  await player.playAt(player.queueIndex >= 0 ? player.queueIndex : 0);
}

async function openPlaylist(pl: Playlist): Promise<void> {
  nav.openPlaylist(pl);
}

onMounted(async () => {
  try {
    playlists.value = await netease.personalized(8);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="home-view">
    <section class="home-hero">
      <div class="hero-text">
        <h2>今天想听点什么</h2>
        <p>搜索一首歌，点击直接播放；队列会自动接续整个列表。</p>
      </div>
      <button
        v-if="player.queueSongs.length > 0"
        type="button"
        class="btn-resume"
        @click="resume"
      >
        <Icon name="play" :size="14" />
        继续上次的队列（{{ player.queueSongs.length }} 首）
      </button>
    </section>

    <section class="home-block">
      <h3>最近播放</h3>
      <SongList
        :songs="recent"
        :active-key="player.songKey"
        :playing="player.playing"
        :show-album="false"
        empty-text="还没有播放记录 —— 去搜索页点一首"
        @play="(i) => player.playList(recent, i)"
      />
    </section>

    <section class="home-block">
      <h3>推荐歌单</h3>
      <div v-if="loading" class="grid">
        <div v-for="i in 4" :key="i" class="grid-card">
          <span class="s3-skeleton grid-cover" />
          <span class="s3-skeleton grid-line" />
        </div>
      </div>
      <div v-else-if="error" class="home-error">{{ error }}</div>
      <div v-else class="grid">
        <button
          v-for="pl in playlists"
          :key="pl.source + ':' + String(pl.id)"
          type="button"
          class="grid-card"
          @click="openPlaylist(pl)"
        >
          <Cover :src="pl.cover" :size="132" :radius="8" fallback-icon="album" />
          <div class="grid-name s3-truncate">{{ pl.name }}</div>
          <div class="grid-sub s3-truncate">{{ pl.playCount || pl.count + ' 首' }}</div>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 24px;
}

.home-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-radius: var(--radius);
  background: linear-gradient(120deg, var(--accent-dim), transparent 70%), var(--panel-bg);
  border: 1px solid var(--app-border);
}

.hero-text h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: var(--text-strong);
}

.hero-text p {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.btn-resume {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 17px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 12px;
  cursor: pointer;
}

.home-block {
  margin-top: 22px;
}

.home-block h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}

.home-error {
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--accent-dim);
  color: var(--accent);
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
