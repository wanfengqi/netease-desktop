<script setup lang="ts">
/**
 * 侧栏导航（S0 建立，S3 换真图标）。
 *
 * 图标从 Icon.vue 的 SVG 表取，不再用字符当图标 —— 字符在不同字体下大小/基线全不一样。
 */
import Icon, { type IconName } from './Icon.vue';
import type { NavItem, NavKey } from '../nav';

defineProps<{
  items: readonly NavItem[];
  active: NavKey;
}>();

const emit = defineEmits<{
  (event: 'select', key: NavKey): void;
}>();
</script>

<template>
  <aside class="sidebar">
    <nav class="nav">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="nav-item"
        :class="{ 'is-active': item.key === active }"
        :title="item.description"
        @click="emit('select', item.key)"
      >
        <span class="nav-icon">
          <Icon :name="item.icon as IconName" :size="16" />
        </span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </nav>
    <div class="sidebar-foot">
      <span class="foot-dot" />
      S3 · 播放链路
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 176px;
  flex: 0 0 176px;
  display: flex;
  flex-direction: column;
  padding: 12px 10px 10px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--app-border);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.nav-item:hover {
  background: var(--item-hover);
}

.nav-item.is-active {
  background: var(--item-active);
  color: var(--text-strong);
}

.nav-icon {
  color: var(--text-muted);
  display: flex;
  align-items: center;
}

.nav-item.is-active .nav-icon {
  color: var(--accent);
}

.sidebar-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  font-size: 10px;
  color: var(--text-muted);
}

.foot-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
</style>
