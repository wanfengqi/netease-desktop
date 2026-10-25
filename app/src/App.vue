<script setup lang="ts">
/**
 * 应用外壳（S3）。
 *
 * 装配顺序有讲究：
 *  1. 先 config.load() —— 音量/播放模式/上次队列都从这来；
 *  2. 再 player.attach(<audio>) —— 引擎需要初始音量，队列需要恢复数据；
 *  3. 最后挂卸载钩子，把待写盘的地毯扫干净（防抖写盘还在 400ms 里时关窗口会丢）。
 *
 * <audio> 元素**只在这一处出现**，而且是注入给引擎的：
 * 约束 3 禁止任何组件直接操作它，播放控制一律经 player store → Player 协调层。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppSidebar from './components/AppSidebar.vue';
import Playbar from './components/Playbar.vue';
import QueuePanel from './components/QueuePanel.vue';
import TitleBar from './components/TitleBar.vue';
import ToastHost from './components/ToastHost.vue';
import Icon from './components/Icon.vue';
import AlbumView from './views/AlbumView.vue';
import ArtistView from './views/ArtistView.vue';
import DiscoverView from './views/DiscoverView.vue';
import HomeView from './views/HomeView.vue';
import DownloadsView from './views/DownloadsView.vue';
import LibraryView from './views/LibraryView.vue';
import LocalView from './views/LocalView.vue';
import PlayerView from './views/PlayerView.vue';
import PlaylistView from './views/PlaylistView.vue';
import SearchView from './views/SearchView.vue';
import SettingsView from './views/SettingsView.vue';
import { NAV_ITEMS, type NavKey } from './nav';
import { useConfigStore } from './stores/config';
import { useHistoryStore } from './stores/history';
import { startDesktopLyricBridge } from './stores/lyrics';
import { useNavigationStore } from './stores/navigation';
import { usePlayerStore } from './stores/player';
import { usePlaylistsStore } from './stores/playlists';

const config = useConfigStore();
const nav = useNavigationStore();
const player = usePlayerStore();
const playlists = usePlaylistsStore();
const history = useHistoryStore();

const audioRef = ref<HTMLAudioElement | null>(null);
const queueOpen = ref(false);
const booted = ref(false);

const route = computed(() => nav.current);
const active = computed<NavKey>(() => nav.activeNav);
const viewTitle = computed(() => {
  const r = route.value;
  if (r.name === 'playlist') return r.playlist.name;
  if (r.name === 'album') return r.album.name;
  if (r.name === 'artist') return r.artist.name;
  if (r.name === 'player') return '正在播放';
  return '';
});

function select(key: NavKey): void {
  queueOpen.value = false;
  nav.goNav(key);
}

function back(): void {
  nav.back();
}

async function flushOnUnload(): Promise<void> {
  player.persistQueue();
  await config.flush();
}

function onBeforeUnload(): void {
  void flushOnUnload();
}

onMounted(async () => {
  await config.load();
  playlists.hydrate();
  history.hydrate();
  history.startTracking();
  if (audioRef.value) player.attach(audioRef.value);
  booted.value = true;
  startDesktopLyricBridge();
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
  void flushOnUnload();
  player.dispose();
  config.dispose();
});
</script>

<template>
  <TitleBar />
  <div class="shell">
    <AppSidebar :items="NAV_ITEMS" :active="active" @select="select" />
    <main class="content">
      <header class="content-head">
        <button v-if="nav.canGoBack" type="button" class="back-btn" title="返回" @click="back">
          <Icon name="back" :size="15" />
        </button>
        <h1>{{ viewTitle || (NAV_ITEMS.find((i) => i.key === active)?.label ?? '') }}</h1>
        <span v-if="player.song" class="content-now s3-truncate">
          正在播放：{{ player.song.name }} — {{ player.song.artistText }}
        </span>
      </header>

      <SearchView v-if="route.name === 'search'" />
      <PlayerView v-else-if="route.name === 'player'" />
      <DiscoverView v-else-if="route.name === 'discover'" />
      <PlaylistView v-else-if="route.name === 'playlist'" :playlist="route.playlist" />
      <AlbumView v-else-if="route.name === 'album'" :album="route.album" />
      <ArtistView v-else-if="route.name === 'artist'" :artist="route.artist" />
      <HomeView v-else-if="route.name === 'home'" />
      <LibraryView v-else-if="route.name === 'library'" />
      <LocalView v-else-if="route.name === 'local'" />
      <DownloadsView v-else-if="route.name === 'downloads'" />
      <SettingsView v-else />
    </main>
  </div>

  <Playbar @open-queue="queueOpen = !queueOpen" />

  <div class="stage">
    <QueuePanel :open="queueOpen" @close="queueOpen = false" />
  </div>

  <ToastHost />
  <audio ref="audioRef" preload="auto" hidden />
  <span v-if="false" class="boot-marker">{{ booted }}</span>
</template>

<style scoped>
.shell {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  position: relative;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  overflow: hidden;
}

.content-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 22px;
  border-bottom: 1px solid var(--app-border);
}

.content-head h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong);
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.back-btn {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  background: var(--panel-hover);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.back-btn:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.content-now {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  min-width: 0;
}

.stage {
  position: absolute;
  inset: calc(var(--titlebar-h)) 0 var(--playbar-h) 0;
  pointer-events: none;
  z-index: 20;
}

.stage > * {
  pointer-events: auto;
}

.boot-marker {
  display: none;
}
</style>
