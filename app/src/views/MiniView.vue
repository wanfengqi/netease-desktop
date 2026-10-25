<script setup lang="ts">
/**
 * 迷你模式视图（S4）。
 *
 * 这个视图跑在**独立的迷你窗**里（electron/windows/miniMode.cjs），
 * 不是主窗口的另一种布局 —— 主窗口那套（侧栏 + 播放条 + 页面）在 340×120 里塞不下，
 * 而文件边界又不允许改 App.vue 做条件渲染。
 *
 * 数据全部来自主窗口（它是播放状态的唯一真源），这里只画、只发指令：
 *   props: title / artist / cover / playing / progress
 *   emits: toggle / prev / next / exit
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    artist?: string;
    cover?: string;
    playing?: boolean;
    progress?: number;
  }>(),
  { title: '未在播放', artist: '主窗口里点一首歌', cover: '', playing: false, progress: 0 },
);

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'exit'): void;
}>();

const fillPercent = computed(() => {
  const raw = Number.isFinite(props.progress) ? props.progress : 0;
  return Math.min(100, Math.max(0, raw * 100));
});
</script>

<template>
  <div class="mini">
    <!-- 拖拽带：整条顶部；里面的按钮必须 no-drag（Electron 只对拖拽元素的后代做减法） -->
    <header class="mini-drag">
      <span class="mini-brand">迷你</span>
      <div class="mini-acts">
        <button type="button" class="mini-act" title="回到主窗口" @click="emit('exit')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="4" width="12" height="12" rx="1.6" />
            <path d="M9 20h9a2 2 0 0 0 2-2V9" />
          </svg>
        </button>
        <button type="button" class="mini-act close" title="退出迷你模式" @click="emit('exit')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8" />
          </svg>
        </button>
      </div>
    </header>

    <div class="mini-body">
      <div class="mini-cover">
        <img v-if="cover" :src="cover" alt="" />
        <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="7" cy="17.2" r="2.8" />
          <circle cx="17.6" cy="15.2" r="2.8" />
          <path d="M9.8 17.2V6.4l10.6-2.1v10.9" />
        </svg>
      </div>

      <div class="mini-meta">
        <div class="mini-title s4-truncate" :title="title">{{ title }}</div>
        <div class="mini-artist s4-truncate" :title="artist">{{ artist }}</div>
        <div class="mini-bar"><span class="mini-bar-fill" :style="{ width: fillPercent + '%' }" /></div>
      </div>

      <div class="mini-ctrls">
        <button type="button" class="mini-ctrl" title="上一首" @click="emit('prev')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="5" y="5" width="2.2" height="14" rx="0.6" />
            <polygon points="19,5 19,19 9,12" />
          </svg>
        </button>
        <button type="button" class="mini-ctrl main" :title="playing ? '暂停' : '播放'" @click="emit('toggle')">
          <svg v-if="playing" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="7" y="5" width="3.4" height="14" rx="1" />
            <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="8,5 19,12 8,19" />
          </svg>
        </button>
        <button type="button" class="mini-ctrl" title="下一首" @click="emit('next')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="16.8" y="5" width="2.2" height="14" rx="0.6" />
            <polygon points="5,5 5,19 15,12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  overflow: hidden;
}

.mini-drag {
  flex: 0 0 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--app-border);
  -webkit-app-region: drag;
  user-select: none;
}

.mini-brand {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.mini-acts {
  display: flex;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.mini-act {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.mini-act:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.mini-act.close:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}

.mini-body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}

.mini-cover {
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel-hover);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

.mini-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mini-meta {
  flex: 1;
  min-width: 0;
}

.mini-title {
  font-size: 12px;
  color: var(--text-strong);
}

.mini-artist {
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-muted);
}

.mini-bar {
  margin-top: 6px;
  height: 3px;
  border-radius: 999px;
  background: var(--track-bg);
  overflow: hidden;
}

.mini-bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s linear;
}

.mini-ctrls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.mini-ctrl {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.mini-ctrl:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.mini-ctrl.main {
  width: 28px;
  height: 28px;
  background: var(--accent);
  color: var(--text-on-accent);
}

.mini-ctrl.main:hover {
  background: var(--accent);
  filter: brightness(1.1);
}
</style>
