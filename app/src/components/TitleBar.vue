<script setup lang="ts">
/**
 * 自绘标题栏（S3）。
 *
 * 硬约束 4（踩过的坑）：拖拽带必须 -webkit-app-region: drag，
 * 而其中的**每一个可点元素**都必须显式 no-drag。
 * Electron 只对拖拽元素的后代做 no-drag 减法 —— 漏一个按钮就点不动，
 * 而且不会报错，只会"看起来没反应"。
 *
 * 因此这里用 .tb-btn 类统一挂 no-drag，并额外给窗口按钮容器也挂一份，
 * 双保险（容器漏了也会被子元素救回来）。
 */
import { onMounted, ref } from 'vue';
import Icon from './Icon.vue';

const maximized = ref(false);

async function call(fn?: () => Promise<unknown>): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch {
    // 非 Electron 环境（纯 vite dev）里没有 window.api.win —— 静默
  }
}

function winApi() {
  return (globalThis as unknown as { window?: { api?: { win?: Window['api']['win'] } } }).window?.api
    ?.win;
}

async function minimize(): Promise<void> {
  await call(winApi()?.minimize);
}

async function toggleMaximize(): Promise<void> {
  const api = winApi();
  if (!api) return;
  const isMax = await api.toggleMaximize().catch(() => false);
  maximized.value = Boolean(isMax);
}

async function close(): Promise<void> {
  await call(winApi()?.close);
}

onMounted(async () => {
  const api = winApi();
  if (!api) return;
  maximized.value = await api.isMaximized().catch(() => false);
});
</script>

<template>
  <header class="titlebar">
    <div class="tb-drag">
      <img class="tb-logo" src="/icon.png" alt="" width="18" height="18" />
      <span class="tb-title">网易云音乐桌面版</span>
    </div>
    <div class="tb-actions">
      <button type="button" class="tb-btn" title="最小化" @click="minimize">
        <Icon name="minus" :size="14" />
      </button>
      <button type="button" class="tb-btn" :title="maximized ? '还原' : '最大化'" @click="toggleMaximize">
        <Icon name="square" :size="12" />
      </button>
      <button type="button" class="tb-btn tb-btn-close" title="关闭" @click="close">
        <Icon name="close" :size="13" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  flex: 0 0 var(--titlebar-h);
  height: var(--titlebar-h);
  display: flex;
  align-items: stretch;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--app-border);
  /* 整条都是拖拽带 */
  -webkit-app-region: drag;
}

.tb-drag {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  -webkit-app-region: drag;
  /* 拖拽区里的文字也不能被选中，否则拖动会变成选区 */
  user-select: none;
}

.tb-logo { width: 18px; height: 18px; object-fit: contain; }
/* Kept as an optional status indicator for themes; branding uses tb-logo. */
.tb-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
  flex: 0 0 auto;
}

.tb-title {
  font-size: 12px;
  color: var(--text);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tb-title em {
  font-style: normal;
  color: var(--text-muted);
  margin-left: 4px;
}

.tb-actions {
  display: flex;
  align-items: stretch;
  /* 容器与每个按钮都声明 no-drag —— 双保险 */
  -webkit-app-region: no-drag;
}

.tb-btn {
  width: 46px;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, color 0.12s ease;
}

.tb-btn:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.tb-btn-close:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}
</style>
