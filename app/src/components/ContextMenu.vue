<script setup lang="ts">
/**
 * 右键菜单（S3）：歌曲行的"下一首播放 / 加入队列 / 从队列移除"。
 *
 * 定位策略：先按点击点放，超出视口就向另一侧翻 —— 右键在窗口右边缘时不翻会飞出屏幕。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue';

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}

const props = defineProps<{
  x: number;
  y: number;
  items: readonly MenuItem[];
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
}>();

const MENU_W = 168;
const MENU_H = 40;

const style = computed(() => {
  const maxX = typeof window === 'undefined' ? 9999 : window.innerWidth;
  const maxY = typeof window === 'undefined' ? 9999 : window.innerHeight;
  const w = MENU_W;
  const h = MENU_H * props.items.length + 8;
  const left = props.x + w > maxX ? Math.max(4, props.x - w) : props.x;
  const top = props.y + h > maxY ? Math.max(4, props.y - h) : props.y;
  return { left: left + 'px', top: top + 'px' };
});

function onGlobalDown(): void {
  emit('close');
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('mousedown', onGlobalDown);
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onGlobalDown);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div class="ctx" :style="style" @mousedown.stop>
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="ctx-item"
      :class="{ 'is-danger': item.danger }"
      :disabled="item.disabled"
      @click="emit('select', item.id)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
.ctx {
  position: fixed;
  min-width: 168px;
  padding: 4px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow-pop);
  z-index: 90;
  display: flex;
  flex-direction: column;
}

.ctx-item {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.ctx-item:hover:not(:disabled) {
  background: var(--item-hover);
  color: var(--text-strong);
}

.ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}

.ctx-item.is-danger:hover {
  color: var(--accent);
}
</style>
