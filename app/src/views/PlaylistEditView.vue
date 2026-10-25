<script setup lang="ts">
/**
 * 歌单编辑页（S6）。
 *
 * 为什么是"页内页"而不是新的导航项：nav.ts 与 App.vue 归协调者统一接线，
 * 本阶段不能碰。所以这个视图由 LibraryView 在本区域内切换渲染，
 * 将来协调者把它挂进 navigation 的 ViewRoute 时，这个组件不用改一行。
 *
 * 编辑是**草稿式**的：改动先落在本地 draft，点保存才写进 store，
 * 避免用户改了一半反悔时已经把库改脏。
 */
import { computed, ref, watch } from 'vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import Icon from '../components/Icon.vue';
import PlaylistIOPanel from '../components/PlaylistIOPanel.vue';
import PlaylistTrackList from '../components/PlaylistTrackList.vue';
import type { Song, SongSource } from '../data/normalize';
import { importPlaylistJSON } from '../core/playlistIO';
import { useFavoritesStore } from '../stores/favorites';
import { usePlayerStore } from '../stores/player';
import { usePlaylistsStore, type LocalPlaylist } from '../stores/playlists';
import { useToastStore } from '../stores/toast';

const props = defineProps<{ playlistId: string }>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'deleted'): void;
}>();

const playlists = usePlaylistsStore();
const favorites = useFavoritesStore();
const player = usePlayerStore();
const toast = useToastStore();

const playlist = computed<LocalPlaylist | null>(() => playlists.byId(props.playlistId));

const name = ref('');
const description = ref('');
const cover = ref('');
const dirty = ref(false);

/** 从 store 同步草稿；切换歌单或首次进入时重置 */
function syncDraft(target: LocalPlaylist | null): void {
  name.value = target?.name ?? '';
  description.value = target?.description ?? '';
  cover.value = target?.cover ?? '';
  dirty.value = false;
}

watch(
  () => props.playlistId,
  () => syncDraft(playlist.value),
  { immediate: true },
);

function touch(): void {
  dirty.value = true;
}

function save(): void {
  const target = playlist.value;
  if (!target) return;
  playlists.update(target.id, {
    name: name.value,
    description: description.value,
    cover: cover.value,
  });
  dirty.value = false;
  toast.push('已保存《' + (name.value.trim() || '(未命名歌单)') + '》');
}

function revert(): void {
  syncDraft(playlist.value);
  toast.push('已放弃未保存的修改');
}

// ---------------------------------------------------------------- 曲目
function play(index: number): void {
  const target = playlist.value;
  if (!target || target.songs.length === 0) return;
  void player.playList(target.songs, index);
}

function onMove(payload: { from: number; to: number }): void {
  const target = playlist.value;
  if (!target) return;
  playlists.move(target.id, payload.from, payload.to);
}

function onRemove(payload: { index: number; song: Song }): void {
  const target = playlist.value;
  if (!target) return;
  playlists.removeAt(target.id, payload.index);
  toast.push('已移除《' + payload.song.name + '》');
}

function onFavorite(song: Song): void {
  const on = favorites.toggle(song);
  toast.push(on ? '已收藏《' + song.name + '》' : '已取消收藏《' + song.name + '》');
}

// ---------------------------------------------------------------- 批量添加
const importOpen = ref(false);

function onImported(payload: { name: string; description: string; cover: string; songs: Song[] }): void {
  const target = playlist.value;
  if (!target) return;
  const added = playlists.addSongsTo(target.id, payload.songs);
  importOpen.value = false;
  toast.push('已添加 ' + String(added) + ' 首到《' + target.name + '》');
}

/** 粘贴 source:id 列表（每行或逗号分隔）——没有元数据时先用占位，播放仍按 source:id 解析 */
const keyText = ref('');
const keySummary = ref('');

const KNOWN: readonly string[] = ['netease', 'migu'];

function addByKeys(): void {
  const target = playlist.value;
  if (!target) return;
  const tokens = keyText.value.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s !== '');
  if (tokens.length === 0) {
    keySummary.value = '没有可识别的条目';
    return;
  }
  const songs: Song[] = [];
  let bad = 0;
  for (const token of tokens) {
    const at = token.indexOf(':');
    if (at <= 0) {
      bad += 1;
      continue;
    }
    const source = token.slice(0, at);
    const id = token.slice(at + 1).trim();
    if (id === '' || !KNOWN.includes(source)) {
      bad += 1;
      continue;
    }
    songs.push({
      id,
      source: source as SongSource,
      name: '未知歌曲（' + token + '）',
      artistText: '',
      artists: [],
      album: { name: '' },
      duration: 0,
    });
  }
  const added = playlists.addSongsTo(target.id, songs);
  keyText.value = '';
  keySummary.value = added === 0 && bad === 0
    ? '这些歌都已在歌单里'
    : '已添加 ' + String(added) + ' 首' + (bad > 0 ? '，' + String(bad) + ' 条格式不对被跳过' : '');
  toast.push(keySummary.value);
}

/** 粘贴 JSON 时用导入解析器（与整单导入同一套校验） */
const jsonText = ref('');
const jsonIssues = ref<string[]>([]);

function addByJSON(): void {
  const target = playlist.value;
  if (!target) return;
  const result = importPlaylistJSON(jsonText.value);
  jsonIssues.value = result.issues.map(
    (i) => (i.level === 'error' ? '错误：' : '提示：') + i.message,
  );
  if (!result.ok) return;
  const added = playlists.addSongsTo(target.id, result.playlist.songs);
  jsonText.value = '';
  toast.push('已从 JSON 添加 ' + String(added) + ' 首');
}

// ---------------------------------------------------------------- 封面上传
function onPickCover(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || file.size > 2 * 1024 * 1024) return;
  const reader = new FileReader();
  reader.onload = () => {
    cover.value = typeof reader.result === 'string' ? reader.result : '';
    touch();
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ---------------------------------------------------------------- 删除
const confirmOpen = ref(false);

function onConfirmDelete(): void {
  const target = playlist.value;
  confirmOpen.value = false;
  if (!target) return;
  const label = target.name;
  playlists.remove(target.id);
  toast.push('已删除歌单《' + label + '》');
  emit('deleted');
}
</script>

<template>
  <div v-if="playlist" class="edit-view">
    <header class="ev-head">
      <button type="button" class="ev-back" title="返回歌单" data-testid="edit-back" @click="emit('close')">
        <Icon name="back" :size="15" />
      </button>
      <h2 class="ev-title">编辑歌单</h2>
      <span v-if="dirty" class="ev-dirty" data-testid="edit-dirty">有未保存的修改</span>
      <div class="ev-head-actions">
        <button v-if="dirty" type="button" class="ev-btn" data-testid="edit-revert" @click="revert">放弃修改</button>
        <button
          type="button"
          class="ev-btn ev-btn-primary"
          :disabled="!dirty"
          data-testid="edit-save"
          @click="save"
        >
          保存
        </button>
      </div>
    </header>

    <div class="ev-body">
      <!-- 基本信息 -->
      <section class="ev-card">
        <h3 class="ev-card-title">基本信息</h3>
        <div class="ev-form">
          <div class="ev-cover">
            <div
              class="ev-cover-box"
              :style="cover ? { backgroundImage: 'url(' + cover + ')' } : {}"
              data-testid="edit-cover"
            >
              <Icon v-if="!cover" name="album" :size="22" />
            </div>
            <label class="ev-btn ev-cover-pick">
              上传封面
              <input type="file" accept="image/*" hidden @change="onPickCover" />
            </label>
            <button v-if="cover" type="button" class="ev-btn" @click="cover = ''; touch()">移除封面</button>
          </div>

          <div class="ev-fields">
            <label class="ev-field">
              <span class="ev-label">歌单名</span>
              <input
                v-model="name"
                type="text"
                class="ev-input"
                data-testid="edit-name"
                maxlength="60"
                @input="touch"
              />
            </label>
            <label class="ev-field">
              <span class="ev-label">描述</span>
              <textarea
                v-model="description"
                class="ev-input ev-area"
                data-testid="edit-description"
                maxlength="200"
                rows="3"
                @input="touch"
              />
            </label>
          </div>
        </div>
      </section>

      <!-- 曲目管理 -->
      <section class="ev-card">
        <h3 class="ev-card-title">
          曲目管理
          <span class="ev-count">{{ playlist.songs.length }} 首</span>
        </h3>
        <p class="ev-tip">拖动左侧手柄排序；点右侧 × 从歌单移除（不影响收藏与历史）。</p>
        <PlaylistTrackList
          :songs="playlist.songs"
          :active-key="player.songKey"
          :playing="player.playing"
          empty-text="还没有歌：用下面的「批量添加」贴入 source:id 或导出的 JSON"
          @play="play"
          @move="onMove"
          @remove="onRemove"
          @favorite="onFavorite"
        />
      </section>

      <!-- 批量添加 -->
      <section class="ev-card">
        <h3 class="ev-card-title">批量添加</h3>
        <div class="ev-two">
          <div class="ev-col">
            <div class="ev-label">粘贴 source:id（每行一个，或逗号分隔）</div>
            <textarea
              v-model="keyText"
              class="ev-input ev-area ev-mono"
              data-testid="edit-keys"
              rows="4"
              spellcheck="false"
              placeholder="netease:186016&#10;migu:600902000006889366"
            />
            <div class="ev-row">
              <button type="button" class="ev-btn ev-btn-primary" data-testid="edit-add-keys" @click="addByKeys">
                添加
              </button>
              <span v-if="keySummary" class="ev-note">{{ keySummary }}</span>
            </div>
          </div>

          <div class="ev-col">
            <div class="ev-label">粘贴导出的 JSON（沿用同一套校验）</div>
            <textarea
              v-model="jsonText"
              class="ev-input ev-area ev-mono"
              data-testid="edit-json"
              rows="4"
              spellcheck="false"
              placeholder='{ "kind": "netease-desktop/playlist", "songs": [...] }'
            />
            <div class="ev-row">
              <button type="button" class="ev-btn ev-btn-primary" data-testid="edit-add-json" @click="addByJSON">
                解析并添加
              </button>
              <button type="button" class="ev-btn" @click="importOpen = true">导入面板…</button>
            </div>
          </div>
        </div>
        <ul v-if="jsonIssues.length > 0" class="ev-issues" data-testid="edit-json-issues">
          <li v-for="(line, i) in jsonIssues" :key="i" class="ev-issue">{{ line }}</li>
        </ul>
      </section>

      <!-- 危险操作 -->
      <section class="ev-card ev-danger-card">
        <h3 class="ev-card-title">危险操作</h3>
        <p class="ev-tip">删除歌单不可恢复；歌单里的歌曲记录会一并删除（收藏与播放历史不受影响）。</p>
        <button
          type="button"
          class="ev-btn ev-btn-danger"
          data-testid="edit-delete"
          @click="confirmOpen = true"
        >
          删除这个歌单
        </button>
      </section>
    </div>

    <ConfirmDialog
      :open="confirmOpen"
      title="删除歌单"
      :message="'确定删除《' + playlist.name + '》吗？歌单里的 ' + String(playlist.songs.length) + ' 首歌记录会一并删除，且无法恢复。'"
      confirm-text="删除"
      danger
      @confirm="onConfirmDelete"
      @cancel="confirmOpen = false"
    />

    <PlaylistIOPanel
      :open="importOpen"
      mode="import"
      :playlist-name="playlist.name"
      :songs="playlist.songs"
      @close="importOpen = false"
      @imported="onImported"
    />
  </div>
</template>

<style scoped>
.edit-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ev-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px 10px;
  border-bottom: 1px solid var(--app-border);
}

.ev-back {
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

.ev-back:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.ev-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong);
}

.ev-dirty {
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 1px 5px;
}

.ev-head-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.ev-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 24px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ev-card {
  border: 1px solid var(--app-border);
  border-radius: var(--radius);
  padding: 14px 16px 16px;
  background: var(--panel-bg);
}

.ev-danger-card {
  border-color: var(--accent-dim);
}

.ev-card-title {
  margin: 0 0 10px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}

.ev-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.ev-tip {
  margin: 0 0 10px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.6;
}

.ev-form {
  display: flex;
  gap: 16px;
}

.ev-cover {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.ev-cover-box {
  width: 96px;
  height: 96px;
  border-radius: 8px;
  background-color: var(--panel-hover);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.ev-cover-pick {
  cursor: pointer;
}

.ev-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ev-field {
  display: block;
}

.ev-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 5px;
}

.ev-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid var(--app-border);
  background: var(--app-bg);
  color: var(--text-strong);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  user-select: text;
}

.ev-input:focus {
  border-color: var(--accent);
}

.ev-area {
  resize: vertical;
  line-height: 1.6;
}

.ev-mono {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
}

.ev-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.ev-col {
  min-width: 0;
}

.ev-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.ev-note {
  font-size: 11px;
  color: var(--text-muted);
}

.ev-issues {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ev-issue {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.6;
  word-break: break-word;
}

.ev-btn {
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

.ev-btn:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.ev-btn-primary {
  background: var(--accent);
  color: var(--text-on-accent);
}

.ev-btn-primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.ev-btn-primary:not(:disabled):hover {
  background: var(--accent);
  filter: brightness(1.08);
}

.ev-btn-danger {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
}

.ev-btn-danger:hover {
  background: var(--accent-dim);
  color: var(--accent);
}
</style>
