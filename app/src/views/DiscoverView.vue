<script setup lang="ts">
/**
 * 排行榜 / 发现（S5）。
 *
 * 两个来源的榜单**天然不是一回事**，所以分 tab 而不是硬揉成一个列表：
 *
 *  - 网易云 /toplist 是 65 个"歌单"实体（有 id、有曲目）。实测 /playlist/detail?id=19723756
 *    直接返回 100 首，所以点进去可以**原样复用 PlaylistView** —— 榜单就是一个 id 可用的歌单，
 *    不重写详情页（硬约束：不许重复实现已通过验收的能力）。
 *
 *  - 咪咕 getRankIndex 是 2 个分组（咪咕特色榜 5 个 / 咪咕尖叫榜 4 个）下的 rankId，
 *    而 rankId **不是**歌单 id：实测 getPlaylistSong(rankId) 返回"歌单不存在"。
 *    取曲目要走 getRankInfo，但主进程白名单里没有这个方法（见报告"做不到的"）。
 *    因此咪咕榜单本阶段只做索引展示 + 明确的"详情未接入"说明，不假装能播。
 */
import { computed, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import RecommendCard from '../components/RecommendCard.vue';
import SectionHeader from '../components/SectionHeader.vue';
import SectionState from '../components/SectionState.vue';
import type { Playlist } from '../data/normalize';
import type { ToplistItem } from '../data/repository/types';
import { useHomeStore } from '../stores/home';
import { useNavigationStore } from '../stores/navigation';
import { useToastStore } from '../stores/toast';

const home = useHomeStore();
const nav = useNavigationStore();
const toast = useToastStore();

/** tab 是纯本地状态：切换不重发请求（两个列表在 onMounted 时一起拉） */
const tab = ref<'netease' | 'migu'>('netease');

const toplistCount = computed(() => home.toplists.items.length);
const rankGroupCount = computed(() => home.miguRanks.items.length);
const rankCount = computed(() =>
  home.miguRanks.items.reduce((sum, g) => sum + g.ranks.length, 0),
);

/**
 * 榜单 -> 歌单对象。PlaylistView 只认 Playlist，
 * count 用 trackCount（榜单实测 100 首），playCount 已格式化好的文本直接透传。
 */
function openToplist(item: ToplistItem): void {
  const playlist: Playlist = {
    source: 'netease',
    id: item.id,
    name: item.name,
    cover: item.cover,
    creator: '',
    count: item.trackCount,
    playCount: item.playCount,
  };
  nav.openPlaylist(playlist);
}

/**
 * 咪咕榜单详情：接口没接进主进程白名单，如实提示而不是给一个点不动的卡片。
 * 用 toast 而不是静默 —— 用户点了要有反馈。
 */
function openMiguRank(rankName: string): void {
  toast.push('「' + rankName + '」的曲目接口（getRankInfo）未接入主进程白名单，本阶段只能展示榜单索引', 'warn');
}

onMounted(() => {
  void home.loadDiscover();
});
</script>

<template>
  <div class="disc-view">
    <header class="disc-head">
      <div class="disc-tabs">
        <button
          type="button"
          class="disc-tab"
          :class="{ 'is-active': tab === 'netease' }"
          @click="tab = 'netease'"
        >
          <Icon name="music" :size="13" />
          网易云榜单
          <span class="disc-count">{{ toplistCount }}</span>
        </button>
        <button
          type="button"
          class="disc-tab"
          :class="{ 'is-active': tab === 'migu' }"
          @click="tab = 'migu'"
        >
          <Icon name="album" :size="13" />
          咪咕榜单
          <span class="disc-count">{{ rankGroupCount }} 组 / {{ rankCount }} 个</span>
        </button>
      </div>
      <span class="disc-note">点开任何一个榜单即可播放整张榜</span>
    </header>

    <div class="disc-body">
      <template v-if="tab === 'netease'">
        <SectionState v-if="home.toplists.status === 'loading'" kind="skeleton" :count="9" />
        <div v-else-if="home.toplists.status === 'ready'" class="grid">
          <RecommendCard
            v-for="item in home.toplists.items"
            :key="'ne:' + item.id"
            :title="item.name"
            :subtitle="item.trackCount + ' 首' + (item.playCount ? ' · ' + item.playCount : '')"
            :cover="item.cover"
            :badge="item.updateFrequency"
            @open="openToplist(item)"
          />
        </div>
        <SectionState
          v-else-if="home.toplists.status === 'error'"
          kind="error"
          title="榜单列表加载失败"
          :detail="home.toplists.error"
          @retry="home.loadToplists(true)"
        />
        <SectionState
          v-else-if="home.toplists.status === 'login-required'"
          kind="login"
          title="榜单需要登录"
          :detail="home.toplists.error"
        />
        <SectionState
          v-else-if="home.toplists.status === 'empty'"
          kind="empty"
          title="没有拿到榜单"
          detail="接口返回了空列表，稍后再试"
        />
        <SectionState v-else kind="unsupported" title="榜单暂不可用" :detail="home.toplists.error" />
      </template>

      <template v-else>
        <SectionState v-if="home.miguRanks.status === 'loading'" kind="skeleton" :count="6" />
        <template v-else-if="home.miguRanks.status === 'ready'">
          <section
            v-for="(group, gi) in home.miguRanks.items"
            :key="group.style + '@' + gi"
            class="rank-group"
          >
            <SectionHeader :title="group.style || '咪咕榜单'" :hint="group.ranks.length + ' 个'">
              <template #action>
                <span class="group-note">曲目接口未接入，仅索引</span>
              </template>
            </SectionHeader>
            <div class="grid">
              <RecommendCard
                v-for="rank in group.ranks"
                :key="rank.rankId"
                :title="rank.rankName"
                subtitle="咪咕榜单"
                :cover="rank.imageUrl"
                badge="排行"
                @open="openMiguRank(rank.rankName)"
              />
            </div>
          </section>
        </template>
        <SectionState
          v-else-if="home.miguRanks.status === 'error'"
          kind="error"
          title="咪咕榜单加载失败"
          :detail="home.miguRanks.error"
          @retry="home.loadMiguRanks(true)"
        />
        <SectionState
          v-else-if="home.miguRanks.status === 'empty'"
          kind="empty"
          title="咪咕没有返回榜单"
        />
        <SectionState v-else kind="unsupported" title="咪咕榜单暂不可用" :detail="home.miguRanks.error" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.disc-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.disc-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px 0;
  border-bottom: 1px solid var(--app-border);
}

.disc-tabs {
  display: flex;
  gap: 4px;
}

.disc-tab {
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

.disc-tab.is-active {
  color: var(--text-strong);
  border-bottom-color: var(--accent);
}

.disc-count {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.disc-note {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}

.disc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px 14px;
}

.rank-group {
  margin-bottom: 20px;
}

.group-note {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
