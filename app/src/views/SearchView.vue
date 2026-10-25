<script setup lang="ts">
/**
 * 搜索页（S3）：搜索框 + 三分栏（歌曲 / 歌单 / 歌手）+ 搜索历史 + 空态。
 *
 * 分栏切换是纯本地状态：三个来源一次搜索就全拿到了，
 * 再点一次"歌单"不该重发请求（旧版每次切 tab 都重搜，慢且烧配额）。
 */
import { computed, onMounted, ref } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import SongList from '../components/SongList.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import type { Song } from '../data/normalize';
import { hotWords } from '../data/source';
import { useConfigStore } from '../stores/config';
import { useNavigationStore } from '../stores/navigation';
import { usePlayerStore } from '../stores/player';
import { useSearchStore } from '../stores/search';
import { useToastStore } from '../stores/toast';

const search = useSearchStore();
const player = usePlayerStore();
const config = useConfigStore();
const nav = useNavigationStore();
const toast = useToastStore();

const input = ref('');
const hot = ref<string[]>([]);

const TABS = [
  { id: 'songs', label: '歌曲' },
  { id: 'playlists', label: '歌单' },
  { id: 'artists', label: '歌手' },
] as const;

const contextFor = ref<{ song: Song; x: number; y: number } | null>(null);

const MENU_ITEMS: readonly MenuItem[] = [
  { id: 'next', label: '下一首播放' },
  { id: 'queue', label: '加入播放队列' },
  { id: 'copy', label: '复制歌名' },
];

function submit(): void {
  const text = input.value.trim();
  if (!text) return;
  void search.submit(text);
}

function fill(word: string): void {
  input.value = word;
  void search.submit(word);
}

function clearInput(): void {
  input.value = '';
  search.clear();
}

/** 点歌：把**当前搜索结果**作为播放队列，从被点的位置开始 —— 这样切歌才连着走 */
async function playSong(index: number): Promise<void> {
  await player.playList(search.songs, index);
}

function onContext(payload: { song: Song; x: number; y: number }): void {
  contextFor.value = payload;
}

function contextAction(id: string): void {
  const payload = contextFor.value;
  contextFor.value = null;
  if (!payload) return;
  if (id === 'next') player.insertNext(payload.song);
  if (id === 'queue') player.addToQueue(payload.song);
  if (id === 'copy') {
    void navigator.clipboard?.writeText(payload.song.name).then(
      () => toast.push('已复制歌名'),
      () => toast.push('复制失败', 'warn'),
    );
  }
}

const songCount = computed(() => search.songs.length);

onMounted(async () => {
  try {
    hot.value = (await hotWords(config.source)).slice(0, 10);
  } catch {
    hot.value = [];
  }
});
</script>

<template>
  <div class="search-view">
    <div class="sv-head">
      <div class="sv-input-wrap">
        <Icon name="search" :size="15" />
        <input
          v-model="input"
          class="sv-input"
          type="text"
          placeholder="搜索歌曲、歌单、歌手（网易云 / 咪咕）"
          spellcheck="false"
          @keydown.enter="submit"
        />
        <button v-if="input" type="button" class="sv-clear" title="清空" @click="clearInput">
          <Icon name="close" :size="12" />
        </button>
      </div>
      <button type="button" class="sv-go" :disabled="search.loading || !input.trim()" @click="submit">
        {{ search.loading ? '搜索中…' : '搜索' }}
      </button>
    </div>

    <div v-if="!search.submitted" class="sv-hints">
      <section v-if="search.history.length > 0" class="sv-block">
        <h3>搜索历史</h3>
        <div class="sv-chips">
          <button v-for="word in search.history" :key="word" type="button" class="chip" @click="fill(word)">
            {{ word }}
          </button>
        </div>
      </section>
      <section v-if="hot.length > 0" class="sv-block">
        <h3>热门搜索</h3>
        <div class="sv-chips">
          <button v-for="word in hot" :key="word" type="button" class="chip chip-hot" @click="fill(word)">
            {{ word }}
          </button>
        </div>
      </section>
      <div class="sv-empty">
        <Icon name="search" :size="30" />
        <p>输入关键词开始搜索</p>
        <span>结果可以直接点击播放；播放失败会提示具体原因</span>
      </div>
    </div>

    <template v-else>
      <div class="sv-tabs">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="sv-tab"
          :class="{ 'is-active': search.tab === tab.id }"
          @click="search.tab = tab.id"
        >
          {{ tab.label }}
          <span class="sv-tab-count">{{ search.counts[tab.id] }}</span>
        </button>
        <span class="sv-result-note">关键词「{{ search.submitted }}」· 歌曲 {{ songCount }} 首</span>
      </div>

      <div class="sv-body">
        <div v-if="search.error" class="sv-error">{{ search.error }}</div>

        <SongList
          v-if="search.tab === 'songs'"
          :songs="search.songs"
          :active-key="player.songKey"
          :playing="player.playing"
          :loading="search.loading"
          empty-text="没有找到相关歌曲"
          @play="playSong"
          @context="onContext"
        />

        <div v-else-if="search.tab === 'playlists'" class="grid">
          <template v-if="search.loading">
            <div v-for="i in 6" :key="i" class="grid-card">
              <span class="s3-skeleton grid-cover" />
              <span class="s3-skeleton grid-line" />
            </div>
          </template>
          <div v-else-if="search.playlists.length === 0" class="sv-empty small">
            <p>没有找到相关歌单</p>
          </div>
          <button
            v-for="pl in search.playlists"
            :key="pl.source + ':' + String(pl.id)"
            type="button"
            class="grid-card"
            @click="nav.openPlaylist(pl)"
          >
            <Cover :src="pl.cover" :size="132" :radius="8" fallback-icon="album" />
            <div class="grid-name s3-truncate">{{ pl.name }}</div>
            <div class="grid-sub s3-truncate">{{ pl.creator || '未知创建者' }} · {{ pl.count }} 首</div>
          </button>
        </div>

        <div v-else class="grid">
          <template v-if="search.loading">
            <div v-for="i in 6" :key="i" class="grid-card">
              <span class="s3-skeleton grid-cover" />
              <span class="s3-skeleton grid-line" />
            </div>
          </template>
          <div v-else-if="search.artists.length === 0" class="sv-empty small">
            <p>没有找到相关歌手</p>
          </div>
          <button
            v-for="ar in search.artists"
            :key="ar.source + ':' + String(ar.id)"
            type="button"
            class="grid-card"
            @click="nav.openArtist(ar)"
          >
            <Cover :src="ar.avatar" :size="132" :radius="66" fallback-icon="artist" />
            <div class="grid-name s3-truncate">{{ ar.name }}</div>
            <div class="grid-sub s3-truncate">{{ ar.songNum }} 首 · {{ ar.albumNum }} 张专辑</div>
          </button>
        </div>
      </div>
    </template>

    <ContextMenu
      v-if="contextFor"
      :x="contextFor.x"
      :y="contextFor.y"
      :items="MENU_ITEMS"
      @select="contextAction"
      @close="contextFor = null"
    />
  </div>
</template>

<style scoped>
.search-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 22px 0;
}

.sv-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.sv-input-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border-radius: 18px;
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
  color: var(--text-muted);
}

.sv-input-wrap:focus-within {
  border-color: var(--accent);
}

.sv-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-strong);
  font-size: 13px;
}

.sv-input::placeholder {
  color: var(--text-muted);
}

.sv-clear {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: var(--panel-hover);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.sv-go {
  flex: 0 0 auto;
  height: 36px;
  padding: 0 20px;
  border: 0;
  border-radius: 18px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 13px;
  cursor: pointer;
}

.sv-go:disabled {
  opacity: 0.45;
  cursor: default;
}

.sv-hints {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 2px;
}

.sv-block {
  margin-bottom: 22px;
}

.sv-block h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.sv-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  border: 1px solid var(--app-border);
  background: var(--panel-bg);
  color: var(--text);
  border-radius: 14px;
  padding: 5px 13px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.chip:hover {
  border-color: var(--accent);
  color: var(--text-strong);
}

.chip-hot {
  color: var(--accent);
}

.sv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.sv-empty p {
  margin: 0;
  font-size: 14px;
  color: var(--text);
}

.sv-empty span {
  font-size: 11px;
}

.sv-empty.small {
  grid-column: 1 / -1;
  padding: 40px;
}

.sv-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  border-bottom: 1px solid var(--app-border);
}

.sv-tab {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.sv-tab.is-active {
  color: var(--text-strong);
  border-bottom-color: var(--accent);
}

.sv-tab-count {
  margin-left: 4px;
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.sv-result-note {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}

.sv-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 0 16px;
}

.sv-error {
  margin-bottom: 10px;
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
  padding-top: 6px;
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
