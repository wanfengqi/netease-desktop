<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppSidebar from './components/AppSidebar.vue';
import PlaceholderView from './components/PlaceholderView.vue';
import { NAV_ITEMS, findNavItem, type NavKey } from './nav';

const active = ref<NavKey>('home');
const versions = ref<string>('preload bridge: 未连接');

const current = computed(() => findNavItem(active.value));

function select(key: NavKey): void {
  active.value = key;
}

onMounted(async () => {
  if (typeof window.api === 'undefined') {
    versions.value = 'preload bridge: 未连接（window.api 缺失）';
    return;
  }
  const v = await window.api.app.versions();
  versions.value = `preload bridge: OK · electron ${v.electron} · chrome ${v.chrome} · node ${v.node}`;
});
</script>

<template>
  <div class="shell">
    <AppSidebar :items="NAV_ITEMS" :active="active" @select="select" />
    <main class="content">
      <header class="content-head">
        <h1>{{ current.label }}</h1>
        <span class="content-sub">{{ current.description }}</span>
      </header>
      <PlaceholderView :title="current.label">
        <p class="placeholder-note">这是 S0 骨架占位页面，业务功能尚未迁移。</p>
        <p class="bridge-state">{{ versions }}</p>
      </PlaceholderView>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
}

.content-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 22px 32px 14px;
  border-bottom: 1px solid var(--app-border);
}

.content-head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-strong);
}

.content-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.placeholder-note {
  margin: 0 0 10px;
}

.bridge-state {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
