<script setup lang="ts">
/**
 * 播放队列抽屉（S3）。
 *
 * 故意做到最薄：只管"点哪首 / 删哪首"，播放语义全在 player store。
 * 删当前曲时的续播由 Player.removeAt 负责（它会续播下一条）。
 */
import { computed } from 'vue';
import { key } from '../data/normalize';
import Icon from './Icon.vue';
import SongRow from './SongRow.vue';
import { usePlayerStore } from '../stores/player';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const player = usePlayerStore();
const songs = computed(() => player.queueSongs);

async function play(index: number): Promise<void> {
  await player.playAt(index);
}

async function remove(index: number): Promise<void> {
  await player.removeAt(index);
}

function clear(): void {
  player.clearQueue();
}

const activeKey = computed(() => player.songKey);
void key;
void props;
</script>

<template>
  <transition name="drawer">
    <aside v-if="open" class="queue-panel">
      <header class="qp-head">
        <div class="qp-title">
          播放队列
          <span class="qp-count">{{ songs.length }} 首</span>
        </div>
        <div class="qp-actions">
          <button v-if="songs.length > 0" type="button" class="qp-link" @click="clear">清空</button>
          <button type="button" class="qp-close" title="收起" @click="emit('close')">
            <Icon name="close" :size="13" />
          </button>
        </div>
      </header>
      <div class="qp-body">
        <div v-if="songs.length === 0" class="qp-empty">队列是空的 —— 在搜索结果里点一首歌</div>
        <template v-else>
          <div v-for="(song, i) in songs" :key="song.source + ':' + String(song.id) + '@' + i" class="qp-row">
            <SongRow
              :song="song"
              :index="i"
              :active-key="activeKey"
              :playing="player.playing"
              :show-album="false"
              @play="play"
            />
            <button type="button" class="qp-remove" title="从队列移除" @click.stop="remove(i)">
              <Icon name="close" :size="12" />
            </button>
          </div>
        </template>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.queue-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  background: var(--panel-bg);
  border-left: 1px solid var(--app-border);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  z-index: 20;
}

.qp-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--app-border);
}

.qp-title {
  font-size: 13px;
  color: var(--text-strong);
  font-weight: 600;
}

.qp-count {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.qp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qp-link {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
}

.qp-link:hover {
  color: var(--accent);
  background: var(--item-hover);
}

.qp-close {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.qp-close:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.qp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.qp-row {
  position: relative;
}

.qp-remove {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: var(--panel-hover);
  color: var(--text-muted);
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.qp-row:hover .qp-remove {
  display: flex;
}

.qp-empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(16px);
  opacity: 0;
}
</style>
