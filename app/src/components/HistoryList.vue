<script setup lang="ts">
/**
 * 播放历史列表（S6）—— 按天分组、逐条播放、单条删除。
 *
 * 与"最近播放"的区别：这里是**完整流水**（上限 HISTORY_LIMIT），
 * 同一首歌会按天/按次出现多条，所以删除要按 (key, playedAt) 定位而不是按 key。
 */
import type { HistoryEntry, HistoryGroup } from '../stores/history';
import { formatDuration } from '../stores/player';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

withDefaults(
  defineProps<{
    groups: readonly HistoryGroup[];
    activeKey?: string;
    playing?: boolean;
    emptyText?: string;
  }>(),
  { activeKey: '', playing: false, emptyText: '还没有播放记录' },
);

const emit = defineEmits<{
  (e: 'play', entry: HistoryEntry): void;
  (e: 'remove', entry: HistoryEntry): void;
  (e: 'favorite', entry: HistoryEntry): void;
}>();

/** HH:mm，历史里需要看到"几点听的" */
function timeOf(ts: number): string {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
</script>

<template>
  <section class="hist">
    <div v-if="groups.length === 0" class="hist-empty">
      <Icon name="music" :size="24" />
      <p>{{ emptyText }}</p>
    </div>

    <div v-for="group in groups" :key="group.day" class="hist-group" data-testid="history-group">
      <div class="hist-day">
        <span class="hist-day-label">{{ group.label }}</span>
        <span class="hist-day-count">{{ group.entries.length }} 首</span>
      </div>
      <div
        v-for="(entry, i) in group.entries"
        :key="entry.key + '@' + entry.playedAt + '@' + i"
        class="hist-row"
        :class="{ 'is-active': activeKey !== '' && activeKey === entry.key }"
        role="button"
        tabindex="0"
        @click="emit('play', entry)"
        @keydown.enter="emit('play', entry)"
      >
        <span class="hist-time">{{ timeOf(entry.playedAt) }}</span>
        <Cover :src="entry.song.album?.picUrl" :size="32" :radius="4" />
        <div class="hist-main">
          <div class="hist-name s3-truncate">{{ entry.song.name || '未知歌曲' }}</div>
          <div class="hist-artist s3-truncate">{{ entry.song.artistText || '未知歌手' }}</div>
        </div>
        <span class="hist-source">{{ entry.song.source === 'migu' ? '咪咕' : '网易云' }}</span>
        <span class="hist-duration">{{ formatDuration(entry.song.duration) }}</span>
        <span class="hist-ops">
          <button type="button" class="op" title="收藏" @click.stop="emit('favorite', entry)">
            <Icon name="album" :size="12" />
          </button>
          <button type="button" class="op op-danger" title="从历史中删除" @click.stop="emit('remove', entry)">
            <Icon name="close" :size="12" />
          </button>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hist {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hist-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 52px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.hist-empty p {
  margin: 0;
}

.hist-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.hist-day {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 10px 6px;
  border-bottom: 1px solid var(--app-border);
  margin-bottom: 5px;
}

.hist-day-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong);
}

.hist-day-count {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.hist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.hist-row:hover {
  background: var(--item-hover);
}

.hist-row.is-active {
  background: var(--item-active);
}

.hist-row.is-active .hist-name {
  color: var(--accent);
}

.hist-time {
  flex: 0 0 40px;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.hist-main {
  flex: 1 1 46%;
  min-width: 0;
}

.hist-name {
  font-size: 13px;
  color: var(--text-strong);
}

.hist-artist {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.hist-source {
  flex: 0 0 46px;
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  padding: 1px 0;
  border-radius: 3px;
  border: 1px solid var(--app-border);
}

.hist-duration {
  flex: 0 0 48px;
  text-align: right;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.hist-ops {
  flex: 0 0 52px;
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}

.op {
  width: 22px;
  height: 22px;
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

.hist-row:hover .op {
  opacity: 1;
}

.op:hover {
  background: var(--panel-hover);
  color: var(--text-strong);
}

.op-danger:hover {
  color: var(--accent);
}
</style>
