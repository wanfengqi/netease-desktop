<script setup lang="ts">
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
    <div class="brand">
      <span class="brand-dot" />
      <span class="brand-text">网易云音乐<em>重构版</em></span>
    </div>
    <nav class="nav">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="nav-item"
        :class="{ 'is-active': item.key === active }"
        @click="emit('select', item.key)"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </nav>
    <div class="sidebar-foot">S0 骨架 · v0.0.0</div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 208px;
  flex: 0 0 208px;
  display: flex;
  flex-direction: column;
  padding: 18px 12px 12px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--app-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 18px;
  color: var(--text-strong);
  font-size: 14px;
  font-weight: 600;
}

.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}

.brand-text em {
  margin-left: 6px;
  font-style: normal;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
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
  width: 16px;
  text-align: center;
  color: var(--accent);
}

.sidebar-foot {
  margin-top: auto;
  padding: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
