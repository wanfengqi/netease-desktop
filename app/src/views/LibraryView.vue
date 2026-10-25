<script setup lang="ts">
/**
 * 我的音乐（S6）—— 用户自己的库。
 *
 * 布局：左侧分类入口 + 右侧内容区。
 *   我喜欢的音乐 / 最近播放 / 播放历史 / 我创建的歌单 / 我收藏的歌单
 *
 * 数据来源分工（别再让两套状态各自漂移）：
 *   收藏 → stores/favorites（镜像 config.favorites，key 去重）
 *   历史 → stores/history（config.extra.history，全量）
 *   歌单 → stores/playlists（config.extra.playlists / collectedPlaylists）
 *   最近播放 → 直接读 history 的前 30 条（与 config.recent 同语义，但带时间戳）
 *
 * 收藏状态的即时反馈靠 store 响应式自动生效：favorites.songs 一变，
 * 这里所有用到它的计算属性都会重算，不需要手动重绘列表。
 */
import { computed, onMounted, ref } from 'vue';
import Cover from '../components/Cover.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import HistoryList from '../components/HistoryList.vue';
import Icon from '../components/Icon.vue';
import PlaylistIOPanel from '../components/PlaylistIOPanel.vue';
import PlaylistTrackList from '../components/PlaylistTrackList.vue';
import PlaylistEditView from './PlaylistEditView.vue';
import PromptDialog from '../components/PromptDialog.vue';
import SongList from '../components/SongList.vue';
import type { Song } from '../data/normalize';
import type { ImportedPlaylist } from '../core/playlistIO';
import { useConfigStore } from '../stores/config';
import { useFavoritesStore } from '../stores/favorites';
import { useHistoryStore, type HistoryEntry } from '../stores/history';
import { usePlaylistsStore, toRemotePlaylist, type CollectedPlaylist, type LocalPlaylist } from '../stores/playlists';
import { usePlayerStore } from '../stores/player';
import { useToastStore } from '../stores/toast';
import { useNavigationStore } from '../stores/navigation';

const config = useConfigStore();
const favorites = useFavoritesStore();
const history = useHistoryStore();
const playlists = usePlaylistsStore();
const player = usePlayerStore();
const toast = useToastStore();
const nav = useNavigationStore();

type Section = 'favorites' | 'recent' | 'history' | 'created' | 'collected';

const section = ref<Section>('favorites');
/** 当前打开的歌单（local） */
const openPlaylistId = ref('');
const openPlaylist = computed<LocalPlaylist | null>(() =>
  openPlaylistId.value ? playlists.byId(openPlaylistId.value) : null,
);
/** 非空时整个内容区换成 PlaylistEditView（nav.ts 归协调者，这里用页内切换） */
const editingId = ref('');


// ---------------------------------------------------------------- 弹窗状态
const promptOpen = ref(false);
const promptMode = ref<'create' | 'edit'>('create');
const confirmOpen = ref(false);
const confirmText = ref('');
const pendingDeleteId = ref('');
const ioOpen = ref(false);
const ioMode = ref<'export' | 'import'>('export');

const SECTIONS: { key: Section; label: string; icon: 'album' | 'music' | 'queue' | 'library' }[] = [
  { key: 'favorites', label: '我喜欢的音乐', icon: 'album' },
  { key: 'recent', label: '最近播放', icon: 'music' },
  { key: 'history', label: '播放历史', icon: 'queue' },
  { key: 'created', label: '我创建的歌单', icon: 'library' },
  { key: 'collected', label: '我收藏的歌单', icon: 'library' },
];

function sectionCount(key: Section): number {
  if (key === 'favorites') return favorites.count;
  if (key === 'recent') return history.recent30.length;
  if (key === 'history') return history.count;
  if (key === 'created') return playlists.count;
  return playlists.collectedCount;
}

// ---------------------------------------------------------------- 列表数据
const favoriteSongs = computed<readonly Song[]>(() => favorites.songs);
const recentSongs = computed<readonly Song[]>(() => history.recent30.map((e) => e.song));
const historyGroups = computed(() => history.groups);

const currentList = computed<readonly Song[]>(() => {
  if (section.value === 'favorites') return favoriteSongs.value;
  if (section.value === 'recent') return recentSongs.value;
  return [];
});

const emptyText = computed(() => {
  if (section.value === 'favorites') return '还没有收藏：在歌曲行上点收藏，或从歌单详情里收藏';
  return '还没有播放记录：播一首歌就会出现在这里';
});

// ---------------------------------------------------------------- 播放
async function play(index: number): Promise<void> {
  await player.playList(currentList.value, index);
}

async function playHistory(entry: HistoryEntry): Promise<void> {
  await player.playList([entry.song], 0);
}

async function playLocal(playlist: LocalPlaylist, index = 0): Promise<void> {
  if (playlist.songs.length === 0) return;
  await player.playList(playlist.songs, index);
}

// ---------------------------------------------------------------- 收藏动作
function toggleFavorite(song: Song): void {
  const on = favorites.toggle(song);
  toast.push(on ? '已收藏《' + song.name + '》' : '已取消收藏《' + song.name + '》');
}

function favoriteFromHistory(entry: HistoryEntry): void {
  toggleFavorite(entry.song);
}

// ---------------------------------------------------------------- 歌单动作
function openCreate(): void {
  promptMode.value = 'create';
  promptOpen.value = true;
}

function openEdit(playlist: LocalPlaylist): void {
  openPlaylistId.value = playlist.id;
  editingId.value = playlist.id;
  section.value = 'created';
}

function onSubmitPrompt(payload: { name: string; description: string; cover: string }): void {
  const created = playlists.create(payload);
  openPlaylistId.value = created.id;
  section.value = 'created';
  promptOpen.value = false;
  toast.push('已创建歌单《' + created.name + '》');
}

/** 删除必须二次确认：先开确认框，确认后才真删 */
function askDelete(playlist: LocalPlaylist): void {
  pendingDeleteId.value = playlist.id;
  confirmText.value = playlist.name;
  confirmOpen.value = true;
}

function onConfirmDelete(): void {
  const id = pendingDeleteId.value;
  confirmOpen.value = false;
  pendingDeleteId.value = '';
  if (!id) return;
  const target = playlists.byId(id);
  playlists.remove(id);
  if (openPlaylistId.value === id) openPlaylistId.value = '';
  toast.push('已删除歌单《' + (target?.name ?? '') + '》');
}

function onMove(payload: { from: number; to: number }): void {
  if (!openPlaylist.value) return;
  playlists.move(openPlaylist.value.id, payload.from, payload.to);
}

function onRemoveTrack(payload: { index: number; song: Song }): void {
  if (!openPlaylist.value) return;
  playlists.removeAt(openPlaylist.value.id, payload.index);
  toast.push('已从歌单移除《' + payload.song.name + '》');
}

// ---------------------------------------------------------------- 导入导出
function openIO(mode: 'export' | 'import'): void {
  ioMode.value = mode;
  ioOpen.value = true;
}

function onImported(playlist: ImportedPlaylist): void {
  const created = playlists.importAsPlaylist(
    { name: playlist.name, description: playlist.description, cover: playlist.cover },
    playlist.songs,
  );
  openPlaylistId.value = created.id;
  section.value = 'created';
  ioOpen.value = false;
  toast.push('已导入歌单《' + created.name + '》：' + String(created.songs.length) + ' 首');
}

function exportCurrent(): void {
  if (!openPlaylist.value) return;
  openIO('export');
}

// ---------------------------------------------------------------- 收藏的线上歌单
function openRemote(item: CollectedPlaylist): void {
  nav.openPlaylist(toRemotePlaylist(item));
}

function clearHistory(): void {
  history.clear();
  toast.push('已清空播放历史');
}

function openLocal(playlist: LocalPlaylist): void {
  openPlaylistId.value = playlist.id;
  section.value = 'created';
}

onMounted(() => {
  // 配置可能还没到（App.vue 的 load 是异步的），watch 会在到达后补一次
  history.startTracking();
  history.hydrate();
  playlists.hydrate();
  void configLoaded();
});

async function configLoaded(): Promise<void> {
  if (!config.loaded) return;
  history.hydrate();
  playlists.hydrate();
}
</script>

<template>
  <div class="library">
    <!-- 左侧分类入口 -->
    <aside class="lb-side">
      <button
        v-for="item in SECTIONS"
        :key="item.key"
        type="button"
        class="lb-entry"
        :class="{ 'is-active': section === item.key && !openPlaylist }"
        data-testid="library-entry"
        @click="section = item.key; openPlaylistId = ''"
      >
        <Icon :name="item.icon" :size="14" />
        <span class="lb-entry-label">{{ item.label }}</span>
        <span class="lb-entry-count">{{ sectionCount(item.key) }}</span>
      </button>

      <div class="lb-side-foot">
        <button type="button" class="lb-btn" data-testid="library-create" @click="openCreate">
          <Icon name="more" :size="13" />
          新建歌单
        </button>
        <button type="button" class="lb-btn" data-testid="library-import" @click="openIO('import')">
          <Icon name="back" :size="13" />
          导入歌单
        </button>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <section v-if="editingId" class="lb-content">
      <PlaylistEditView
        :playlist-id="editingId"
        @close="editingId = ''"
        @deleted="editingId = ''; openPlaylistId = ''"
      />
    </section>

    <section v-else class="lb-content">
      <!-- 歌单详情 -->
      <template v-if="openPlaylist">
        <header class="ply-head">
          <Cover :src="openPlaylist.cover" :size="112" :radius="10" fallback-icon="album" />
          <div class="ply-meta">
            <div class="ply-kind"><Icon name="library" :size="12" /> 我创建的歌单</div>
            <h2 class="ply-title">{{ openPlaylist.name }}</h2>
            <p v-if="openPlaylist.description" class="ply-desc">{{ openPlaylist.description }}</p>
            <p class="ply-sub">{{ openPlaylist.songs.length }} 首</p>
            <div class="ply-actions">
              <button
                type="button"
                class="lb-primary"
                :disabled="openPlaylist.songs.length === 0"
                @click="playLocal(openPlaylist, 0)"
              >
                <Icon name="play" :size="13" />
                播放全部
              </button>
              <button type="button" class="lb-btn" data-testid="playlist-edit" @click="openEdit(openPlaylist)">
                编辑
              </button>
              <button type="button" class="lb-btn" data-testid="playlist-export" @click="exportCurrent">
                导出
              </button>
              <button
                type="button"
                class="lb-btn lb-btn-danger"
                data-testid="playlist-delete"
                @click="askDelete(openPlaylist)"
              >
                删除
              </button>
            </div>
          </div>
        </header>
        <div class="lb-body">
          <PlaylistTrackList
            :songs="openPlaylist.songs"
            :active-key="player.songKey"
            :playing="player.playing"
            empty-text="这个歌单还没有歌：到歌单详情/搜索结果里「加入歌单」"
            @play="playLocal(openPlaylist, $event)"
            @move="onMove"
            @remove="onRemoveTrack"
            @favorite="toggleFavorite"
          />
        </div>
      </template>

      <!-- 歌单集合 -->
      <template v-else-if="section === 'created' || section === 'collected'">
        <header class="lb-head">
          <h2 class="lb-title">{{ section === 'created' ? '我创建的歌单' : '我收藏的歌单' }}</h2>
          <span class="lb-sub">{{ section === 'created' ? playlists.count : playlists.collectedCount }} 个</span>
        </header>
        <div class="lb-body">
          <div
            v-if="(section === 'created' ? playlists.count : playlists.collectedCount) === 0"
            class="lb-empty"
          >
            <Icon name="library" :size="24" />
            <p>{{ section === 'created' ? '还没有歌单：点左下角「新建歌单」' : '还没有收藏线上歌单' }}</p>
          </div>

          <div v-else class="ply-grid">
            <template v-if="section === 'created'">
              <article
                v-for="item in playlists.local"
                :key="item.id"
                class="ply-card"
                data-testid="playlist-card"
                @click="openLocal(item)"
              >
                <Cover :src="item.cover" :size="112" :radius="8" fallback-icon="album" />
                <div class="ply-card-name s3-truncate">{{ item.name }}</div>
                <div class="ply-card-sub">{{ item.songs.length }} 首</div>
                <div class="ply-card-ops">
                  <button type="button" class="op" title="编辑" @click.stop="openEdit(item)">编辑</button>
                  <button type="button" class="op op-danger" title="删除" @click.stop="askDelete(item)">
                    删除
                  </button>
                </div>
              </article>
            </template>

            <template v-else>
              <article
                v-for="item in playlists.collected"
                :key="item.id"
                class="ply-card"
                data-testid="collected-card"
                @click="openRemote(item)"
              >
                <Cover :src="item.cover" :size="112" :radius="8" fallback-icon="album" />
                <div class="ply-card-name s3-truncate">{{ item.name }}</div>
                <div class="ply-card-sub">
                  {{ item.source === 'migu' ? '咪咕' : '网易云' }} · {{ item.count }} 首
                </div>
                <div class="ply-card-ops">
                  <button type="button" class="op op-danger" @click.stop="playlists.uncollect(item.id)">
                    取消收藏
                  </button>
                </div>
              </article>
            </template>
          </div>
        </div>
      </template>

      <!-- 播放历史 -->
      <template v-else-if="section === 'history'">
        <header class="lb-head">
          <h2 class="lb-title">播放历史</h2>
          <span class="lb-sub">{{ history.count }} 条 · 最多保留 5000 条</span>
          <button
            v-if="history.count > 0"
            type="button"
            class="lb-btn lb-btn-danger lb-head-act"
            data-testid="history-clear"
            @click="clearHistory"
          >
            清空历史
          </button>
        </header>
        <div class="lb-body">
          <HistoryList
            :groups="historyGroups"
            :active-key="player.songKey"
            :playing="player.playing"
            @play="playHistory"
            @remove="history.remove"
            @favorite="favoriteFromHistory"
          />
        </div>
      </template>

      <!-- 收藏 / 最近播放 -->
      <template v-else>
        <header class="lb-head">
          <h2 class="lb-title">{{ section === 'favorites' ? '我喜欢的音乐' : '最近播放' }}</h2>
          <span class="lb-sub">{{ section === 'favorites' ? favorites.count : recentSongs.length }} 首</span>
        </header>
        <div class="lb-body">
          <SongList
            :songs="currentList"
            :active-key="player.songKey"
            :playing="player.playing"
            :show-album="false"
            :empty-text="emptyText"
            @play="play"
          />
        </div>
      </template>
    </section>

    <!-- 弹窗 -->
    <PromptDialog
      :open="promptOpen"
      title="新建歌单"
      confirm-text="创建"
      @submit="onSubmitPrompt"
      @cancel="promptOpen = false"
    />

    <ConfirmDialog
      :open="confirmOpen"
      title="删除歌单"
      :message="'确定删除《' + confirmText + '》吗？歌单里的歌曲记录会一并删除，且无法恢复。'"
      confirm-text="删除"
      danger
      @confirm="onConfirmDelete"
      @cancel="confirmOpen = false; pendingDeleteId = ''"
    />

    <PlaylistIOPanel
      :open="ioOpen"
      :mode="ioMode"
      :playlist-name="openPlaylist?.name ?? '我的歌单'"
      :playlist-description="openPlaylist?.description ?? ''"
      :playlist-cover="openPlaylist?.cover ?? ''"
      :songs="openPlaylist?.songs ?? []"
      @close="ioOpen = false"
      @imported="onImported"
    />
  </div>
</template>

<style scoped>
.library {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* ---------------------------------------------------------- 左侧入口 */
.lb-side {
  flex: 0 0 196px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 10px 12px;
  border-right: 1px solid var(--app-border);
  overflow-y: auto;
}

.lb-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.lb-entry:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.lb-entry.is-active {
  background: var(--item-active);
  color: var(--text-strong);
}

.lb-entry-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-entry-count {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.lb-side-foot {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ---------------------------------------------------------- 右侧内容 */
.lb-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lb-head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 24px 10px;
}

.lb-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong);
}

.lb-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.lb-head-act {
  margin-left: auto;
}

.lb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 20px;
}

.lb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 52px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.lb-empty p {
  margin: 0;
}

/* ---------------------------------------------------------- 歌单详情 */
.ply-head {
  flex: 0 0 auto;
  display: flex;
  gap: 16px;
  padding: 18px 24px 12px;
}

.ply-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}

.ply-kind {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted);
}

.ply-title {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ply-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  max-width: 560px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ply-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.ply-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

/* ---------------------------------------------------------- 歌单卡片 */
.ply-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 16px;
}

.ply-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  padding: 8px;
  border-radius: 9px;
}

.ply-card:hover {
  background: var(--item-hover);
}

.ply-card-name {
  font-size: 12px;
  color: var(--text-strong);
}

.ply-card-sub {
  font-size: 10px;
  color: var(--text-muted);
}

.ply-card-ops {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ply-card:hover .ply-card-ops {
  opacity: 1;
}

.op {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  font-family: inherit;
  padding: 2px 5px;
  border-radius: 4px;
  cursor: pointer;
}

.op:hover {
  background: var(--panel-hover);
  color: var(--text-strong);
}

.op-danger:hover {
  color: var(--accent);
}

/* ---------------------------------------------------------- 按钮 */
.lb-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 13px;
  background: var(--panel-hover);
  color: var(--text);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.lb-btn:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.lb-btn-danger:hover {
  color: var(--accent);
}

.lb-primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 15px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.lb-primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.lb-primary:not(:disabled):hover {
  filter: brightness(1.08);
}
</style>
