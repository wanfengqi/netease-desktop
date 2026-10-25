<script setup lang="ts">
/**
 * toast 宿主（S3）。播放失败必须被看见 —— 静默失败是旧版最被诟病的一点。
 */
import { useToastStore } from '../stores/toast';

const toast = useToastStore();
</script>

<template>
  <div class="toast-host">
    <transition-group name="toast">
      <div
        v-for="item in toast.items"
        :key="item.id"
        class="toast"
        :class="'toast-' + item.kind"
        role="status"
        @click="toast.dismiss(item.id)"
      >
        {{ item.message }}
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  bottom: calc(var(--playbar-h) + 18px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 80;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  max-width: 460px;
  padding: 9px 16px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow-pop);
  color: var(--text-strong);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}

.toast-warn {
  border-color: var(--accent);
  color: var(--text-strong);
}

.toast-error {
  border-color: var(--accent);
  background: var(--accent-dim);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
