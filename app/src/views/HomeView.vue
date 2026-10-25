<script setup lang="ts">
/**
 * 首页（S5）—— "打开就有东西看"。
 *
 * 结构：问候 + 快捷入口 -> 最近播放（横滑）-> 每日推荐 -> 推荐歌单 -> 新歌速递 -> 热门搜索。
 *
 * 三条刻意的设计：
 *
 * 1. **每个区块自己管三态**。一次打 5 个接口，任何一个挂了都不能把整页拖黑；
 *    状态在 stores/home.ts 里按区块隔离，这里只按 status 分别渲染。
 *
 * 2. **"需要登录 / 接口不可用"不是错误**。网易云每日推荐要 cookie，咪咕每日推荐
 *    恒返回 200205（见 docs/S2遗留与S3交接.md 1.3）。这两种显示成说明卡而不是红字，
 *    用户才知道下一步该干什么，而不是一直点"重试"。
 *
 * 3. **图标一律内联 SVG（Icon.vue）**，颜色一律走 CSS 变量。
 */
import { computed, onMounted } from 'vue';
import Icon from '../components/Icon.vue';
import NewSongCard from '../components/NewSongCard.vue';
import RecommendCard from '../components/RecommendCard.vue';
import SectionHeader from '../components/SectionHeader.vue';
import SectionState from '../components/SectionState.vue';
import SongRail from '../components/SongRail.vue';
import type { Playlist } from '../data/normalize';
import type { RecommendPlaylist } from '../data/repository/types';
import { useConfigStore } from '../stores/config';
import { useHomeStore } from '../stores/home';
import { useNavigationStore } from '../stores/navigation';
import { usePlayerStore } from '../stores/player';
import { useSearchStore } from '../stores/search';

const home = useHomeStore();
const player = usePlayerStore();
const config = useConfigStore();
const nav = useNavigationStore();
const search = useSearchStore();

/** 时段问候：只用本地时间，不依赖任何接口 */
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 5) return '夜还长';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const sourceLabel = computed(() => (config.source === 'migu' ? '咪咕音乐' : '网易云音乐'));

async function resume(): Promise<void> {
  if (player.queueSongs.length === 0) return;
  await player.playAt(player.queueIndex >= 0 ? player.queueIndex : 0);
}

async function playRecent(index: number): Promise<void> {
  await player.playList(home.recent, index);
}

async function playDaily(index: number): Promise<void> {
  await player.playList(home.daily.items, index);
}

async function playNewSong(index: number): Promise<void> {
  await player.playList(home.newSongs.items, index);
}

/** 推荐歌单是 Playlist 的超集（多一个 copywriter），导航层只认 Playlist */
function toPlaylist(pl: RecommendPlaylist): Playlist {
  return {
    source: pl.source,
    id: pl.id,
    name: pl.name,
    cover: pl.cover,
    creator: pl.creator,
    count: pl.count,
    playCount: pl.playCount,
  };
}

function openPlaylist(pl: RecommendPlaylist): void {
  nav.openPlaylist(toPlaylist(pl));
}

/**
 * 推荐歌单副标题：推荐语 > 播放量 > 曲目数。
 * 咪咕的 getRecommendPlaylist 不返回曲目数与播放量（实测全是 0/空），
 * 拼出 "0 首" 会让用户误以为歌单是空的，所以两个都没有时干脆留空。
 */
function playlistSubtitle(pl: RecommendPlaylist): string {
  if (pl.copywriter) return pl.copywriter;
  if (pl.playCount) return '播放 ' + pl.playCount;
  return pl.count > 0 ? pl.count + ' 首' : '';
}

/** 点热搜词：切到搜索页并直接搜 —— 搜索 store 是全局的，SearchView 会读到结果 */
function searchWord(word: string): void {
  nav.goNav('search');
  void search.submit(word);
}

onMounted(() => {
  void home.loadHome();
});
</script>

<template>
  <div class="home-view">
    <section class="home-hero">
      <div class="hero-text">
        <h2>{{ greeting }}</h2>
        <p>今天听点什么 —— {{ sourceLabel }}的推荐已经备好，点一下就播。</p>
      </div>
      <div class="hero-actions">
        <button
          v-if="player.queueSongs.length > 0"
          type="button"
          class="btn-resume"
          @click="resume"
        >
          <Icon name="play" :size="14" />
          继续上次的队列（{{ player.queueSongs.length }} 首）
        </button>
        <div class="quick">
          <button type="button" class="quick-item" @click="nav.goNav('search')">
            <Icon name="search" :size="14" />
            搜索
          </button>
          <button type="button" class="quick-item" @click="nav.goNav('library')">
            <Icon name="library" :size="14" />
            我的音乐
          </button>
          <button type="button" class="quick-item" @click="nav.goNav('settings')">
            <Icon name="settings" :size="14" />
            设置
          </button>
        </div>
      </div>
    </section>

    <!-- 最近播放：纯本地数据（config 已 load 完才会渲染首页），没有加载态 -->
    <section class="home-block">
      <SectionHeader title="最近播放" :hint="home.recent.length > 0 ? home.recent.length + ' 首' : ''" />
      <SongRail
        v-if="home.recent.length > 0"
        :songs="home.recent"
        :active-key="player.songKey"
        :playing="player.playing"
        @play="playRecent"
      />
      <SectionState
        v-else
        kind="empty"
        title="还没有播放记录"
        detail="去搜索页点一首，或者先播放下面推荐的歌单"
      />
    </section>

    <!-- 每日推荐 -->
    <section class="home-block">
      <SectionHeader
        title="每日推荐"
        :hint="home.daily.status === 'ready' ? home.daily.items.length + ' 首' : ''"
      >
        <template #action>
          <button
            v-if="home.daily.status === 'ready' || home.daily.status === 'empty'"
            type="button"
            class="link-btn"
            @click="home.loadDaily(true)"
          >
            刷新
          </button>
        </template>
      </SectionHeader>
      <SectionState v-if="home.daily.status === 'loading'" kind="skeleton" :count="6" />
      <SongRail
        v-else-if="home.daily.status === 'ready'"
        :songs="home.daily.items"
        :active-key="player.songKey"
        :playing="player.playing"
        @play="playDaily"
      />
      <SectionState
        v-else-if="home.daily.status === 'login-required'"
        kind="login"
        title="每日推荐需要登录"
        :detail="home.daily.error"
      />
      <SectionState
        v-else-if="home.daily.status === 'unsupported'"
        kind="unsupported"
        title="这个音源的每日推荐暂不可用"
        :detail="home.daily.error"
      />
      <SectionState
        v-else-if="home.daily.status === 'error'"
        kind="error"
        title="每日推荐加载失败"
        :detail="home.daily.error"
        @retry="home.loadDaily(true)"
      />
      <SectionState v-else kind="empty" title="今天没有推荐曲目" detail="过一段时间再来看看" />
    </section>

    <!-- 推荐歌单 -->
    <section class="home-block">
      <SectionHeader
        title="推荐歌单"
        :hint="home.recommend.status === 'ready' ? home.recommend.items.length + ' 个' : ''"
      />
      <SectionState v-if="home.recommend.status === 'loading'" kind="skeleton" :count="5" />
      <div v-else-if="home.recommend.status === 'ready'" class="grid">
        <RecommendCard
          v-for="pl in home.recommend.items"
          :key="pl.source + ':' + String(pl.id)"
          :title="pl.name"
          :subtitle="playlistSubtitle(pl)"
          :cover="pl.cover"
          :badge="pl.playCount"
          @open="openPlaylist(pl)"
        />
      </div>
      <SectionState
        v-else-if="home.recommend.status === 'error'"
        kind="error"
        title="推荐歌单加载失败"
        :detail="home.recommend.error"
        @retry="home.loadRecommend(true)"
      />
      <SectionState
        v-else-if="home.recommend.status === 'login-required'"
        kind="login"
        title="推荐歌单需要登录"
        :detail="home.recommend.error"
      />
      <SectionState
        v-else-if="home.recommend.status === 'empty'"
        kind="empty"
        title="暂时没有推荐歌单"
        detail="换个音源或稍后再试"
      />
      <SectionState v-else kind="unsupported" title="推荐歌单暂不可用" :detail="home.recommend.error" />
    </section>

    <!-- 新歌速递 -->
    <section class="home-block">
      <SectionHeader
        title="新歌速递"
        :hint="home.newSongs.status === 'ready' ? home.newSongs.items.length + ' 首' : ''"
      />
      <SectionState v-if="home.newSongs.status === 'loading'" kind="skeleton" :count="5" />
      <div v-else-if="home.newSongs.status === 'ready'" class="grid">
        <NewSongCard
          v-for="(song, i) in home.newSongs.items"
          :key="song.source + ':' + String(song.id) + '@' + i"
          :song="song"
          :active="player.songKey === song.source + ':' + String(song.id)"
          :playing="player.playing"
          @play="playNewSong(i)"
        />
      </div>
      <SectionState
        v-else-if="home.newSongs.status === 'error'"
        kind="error"
        title="新歌速递加载失败"
        :detail="home.newSongs.error"
        @retry="home.loadNewSongs(true)"
      />
      <SectionState v-else-if="home.newSongs.status === 'empty'" kind="empty" title="今天还没有新歌数据" />
      <SectionState v-else kind="unsupported" title="新歌速递暂不可用" :detail="home.newSongs.error" />
    </section>

    <!-- 热门搜索 -->
    <section class="home-block last">
      <SectionHeader title="热门搜索" :hint="home.hot.status === 'ready' ? home.hot.items.length + ' 条' : ''" />
      <SectionState v-if="home.hot.status === 'loading'" kind="skeleton" :count="6" shape="row" />
      <div v-else-if="home.hot.status === 'ready'" class="hot-list">
        <button
          v-for="(w, i) in home.hot.items"
          :key="w.word + '@' + i"
          type="button"
          class="hot-chip"
          :class="{ 'is-top': i < 3 }"
          @click="searchWord(w.word)"
        >
          <span class="hot-rank">{{ i + 1 }}</span>
          <span class="s3-truncate">{{ w.word }}</span>
        </button>
      </div>
      <SectionState
        v-else-if="home.hot.status === 'error'"
        kind="error"
        title="热门搜索加载失败"
        :detail="home.hot.error"
        @retry="home.loadHot(true)"
      />
      <SectionState v-else-if="home.hot.status === 'empty'" kind="empty" title="暂时没有热搜数据" />
      <SectionState v-else kind="unsupported" title="热搜暂不可用" :detail="home.hot.error" />
    </section>
  </div>
</template>

<style scoped>
.home-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 28px;
}

.home-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 18px;
  border-radius: var(--radius);
  background: linear-gradient(120deg, var(--accent-dim), transparent 70%), var(--panel-bg);
  border: 1px solid var(--app-border);
}

.hero-text {
  min-width: 0;
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

.hero-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-resume {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 15px;
  border: 0;
  border-radius: 16px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 12px;
  cursor: pointer;
}

.quick {
  display: flex;
  gap: 6px;
}

.quick-item {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--app-border);
  border-radius: 15px;
  background: var(--panel-bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.quick-item:hover {
  border-color: var(--accent);
  color: var(--text-strong);
}

.home-block {
  margin-top: 20px;
}

.home-block.last {
  padding-bottom: 6px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}

.link-btn:hover {
  color: var(--accent);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px 14px;
}

.hot-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px 12px;
}

.hot-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--panel-bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.hot-chip:hover {
  border-color: var(--accent);
  color: var(--text-strong);
}

.hot-rank {
  flex: 0 0 16px;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.hot-chip.is-top .hot-rank {
  color: var(--accent);
}
</style>
