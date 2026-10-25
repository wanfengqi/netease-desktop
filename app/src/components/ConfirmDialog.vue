<script setup lang="ts">
/**
 * 二次确认框（S6）—— 删除歌单等不可逆操作必须先过这一关。
 *
 * 不用 window.confirm：Electron 的无边框窗口里原生对话框样式与主题割裂，
 * 而且原生 confirm 无法截图证明"确认框确实存在"（本阶段验收要求截图）。
 */
import { onBeforeUnmount, onMounted } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    /** 确认按钮文案 */
    confirmText?: string;
    cancelText?: string;
    /** 危险操作：确认按钮走强调色 */
    danger?: boolean;
  }>(),
  { confirmText: '确认', cancelText: '取消', danger: false },
);

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function onKey(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') emit('cancel');
  if (event.key === 'Enter') emit('confirm');
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="open" class="mask" @click.self="emit('cancel')">
    <div class="dialog" role="alertdialog" aria-modal="true" data-testid="confirm-dialog">
      <div class="dlg-head">
        <span class="dlg-icon" :class="{ 'is-danger': danger }">
          <Icon name="more" :size="16" />
        </span>
        <h3 class="dlg-title">{{ title }}</h3>
      </div>
      <p class="dlg-msg">{{ message }}</p>
      <div class="dlg-actions">
        <button type="button" class="btn btn-ghost" data-testid="confirm-cancel" @click="emit('cancel')">
          {{ cancelText }}
        </button>
        <button
          type="button"
          class="btn"
          :class="danger ? 'btn-danger' : 'btn-accent'"
          data-testid="confirm-ok"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
}

.dialog {
  width: 380px;
  max-width: calc(100vw - 48px);
  padding: 18px 20px 16px;
  border-radius: var(--radius);
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow-pop);
}

.dlg-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.dlg-icon {
  display: flex;
  color: var(--text-muted);
}

.dlg-icon.is-danger {
  color: var(--accent);
}

.dlg-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.dlg-msg {
  margin: 10px 0 16px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}

.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 15px;
  font-size: 12px;
  cursor: pointer;
}

.btn-ghost {
  background: var(--panel-hover);
  color: var(--text);
}

.btn-ghost:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.btn-accent {
  background: var(--accent);
  color: var(--text-on-accent);
}

.btn-danger {
  background: var(--accent);
  color: var(--text-on-accent);
}

.btn:hover {
  filter: brightness(1.08);
}
</style>
