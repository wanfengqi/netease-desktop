<script setup lang="ts">
/**
 * 我的音乐（S3）：收藏 + 最近播放。
 *
 * 数据全部来自配置（S2 的 favorites / recent），这里只做展示与播放接线。
 * 收藏的增删留到 S4 —— 本阶段的目标是"端到端能出声"，不做半吊子写操作。
 */
import { computed, ref } from 'vue';
import SongList from '../components/SongList.vue';
import Icon from '../components/Icon.vue';
import type { Song } from '../data/normalize';
import { useConfigStore } from '../stores/config';
import { usePlayerStore } from '../stores/player';

const config = useConfigStore();
const player = usePlayerStore();

const tab = ref<'favorites' | 'recent'>('recent');
const favorites = computed<readonly Song[]>(() => config.favorites);
const recent = computed<readonly Song[]>(() => config.recent);
const list = computed<readonly Song[]>(() => (tab.value === 'favorites' ? favorites.value : recent.value));


async function play(index: number): Promise<void> {
  await player.playList(list.value, index);
}
</script>

<template>
  <div class="library-view">
    <div class="lb-tabs">
      <button type="button" class="lb-tab" :class="{ 'is-active': tab === 'recent' }" @click="tab = 'recent'">
        <Icon name="music" :size="13" />
        最近播放
        <span class="lb-count">{{ recent.length }}</span>
      </button>
      <button type="button" class="lb-tab" :class="{ 'is-active': tab === 'favorites' }" @click="tab = 'favorites'">
        <Icon name="album" :size="13" />
        我的收藏
        <span class="lb-count">{{ favorites.length }}</span>
      </button>
    </div>

    <div class="lb-body">
      <SongList
        :songs="list"
        :active-key="player.songKey"
        :playing="player.playing"
        :show-album="false"
        :empty-text="tab === 'favorites' ? '还没有收藏（S4 开放收藏）' : '还没有播放记录'"
        @play="play"
      />
    </div>
  </div>
</template>

<style scoped>
.library-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lb-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 14px 24px 0;
  border-bottom: 1px solid var(--app-border);
}

.lb-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  padding: 9px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.lb-tab.is-active {
  color: var(--text-strong);
  border-bottom-color: var(--accent);
}

.lb-count {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.lb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 24px 20px;
}
</style>
