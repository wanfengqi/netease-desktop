<script setup lang="ts">
/**
 * 输入框弹窗（S6）—— 新建歌单 / 改名 + 描述 + 封面上传。
 *
 * 封面上传用 <input type="file"> + FileReader 读成 data URL 直接存进歌单，
 * 这样不需要任何新 IPC（原生文件对话框归 S4 那一路，本阶段不能碰）。
 */
import { ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** 是否显示描述输入框 */
    withDescription?: boolean;
    /** 是否允许上传封面 */
    withCover?: boolean;
    nameLabel?: string;
    descriptionLabel?: string;
    confirmText?: string;
    /** 初始值 */
    initialName?: string;
    initialDescription?: string;
    initialCover?: string;
  }>(),
  {
    withDescription: true,
    withCover: true,
    nameLabel: '歌单名',
    descriptionLabel: '描述（可选）',
    confirmText: '保存',
    initialName: '',
    initialDescription: '',
    initialCover: '',
  },
);

const emit = defineEmits<{
  (e: 'submit', payload: { name: string; description: string; cover: string }): void;
  (e: 'cancel'): void;
}>();

const name = ref('');
const description = ref('');
const cover = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.initialName;
    description.value = props.initialDescription;
    cover.value = props.initialCover;
  },
  { immediate: true },
);

function onPickCover(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // 超过 2MB 的图直接读成 data URL 会把配置撑大，这里挡掉
  if (file.size > 2 * 1024 * 1024) return;
  const reader = new FileReader();
  reader.onload = () => {
    cover.value = typeof reader.result === 'string' ? reader.result : '';
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function submit(): void {
  emit('submit', { name: name.value.trim(), description: description.value.trim(), cover: cover.value });
}
</script>

<template>
  <div v-if="open" class="mask" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true" data-testid="prompt-dialog">
      <h3 class="dlg-title">{{ title }}</h3>

      <label class="field">
        <span class="field-label">{{ nameLabel }}</span>
        <input
          v-model="name"
          type="text"
          class="field-input"
          data-testid="prompt-name"
          maxlength="60"
          placeholder="给歌单起个名字"
          @keydown.enter="submit"
        />
      </label>

      <label v-if="withDescription" class="field">
        <span class="field-label">{{ descriptionLabel }}</span>
        <textarea
          v-model="description"
          class="field-input field-area"
          data-testid="prompt-description"
          maxlength="200"
          rows="3"
          placeholder="这张歌单是什么"
        />
      </label>

      <div v-if="withCover" class="field">
        <span class="field-label">封面（可选）</span>
        <div class="cover-row">
          <div class="cover-preview" :style="cover ? { backgroundImage: 'url(' + cover + ')' } : {}">
            <Icon v-if="!cover" name="album" :size="18" />
          </div>
          <label class="btn btn-ghost cover-pick">
            选择图片
            <input type="file" accept="image/*" hidden @change="onPickCover" />
          </label>
          <button v-if="cover" type="button" class="btn btn-ghost" @click="cover = ''">移除</button>
        </div>
      </div>

      <div class="dlg-actions">
        <button type="button" class="btn btn-ghost" @click="emit('cancel')">{{ '取消' }}</button>
        <button type="button" class="btn btn-accent" data-testid="prompt-submit" @click="submit">
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
  z-index: 110;
}

.dialog {
  width: 420px;
  max-width: calc(100vw - 48px);
  padding: 18px 20px 16px;
  border-radius: var(--radius);
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow-pop);
}

.dlg-title {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.field {
  display: block;
  margin-bottom: 12px;
}

.field-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 5px;
}

.field-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid var(--app-border);
  background: var(--app-bg);
  color: var(--text-strong);
  font-size: 12px;
  outline: none;
}

.field-input:focus {
  border-color: var(--accent);
}

.field-area {
  resize: vertical;
  line-height: 1.6;
}

.cover-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cover-preview {
  width: 48px;
  height: 48px;
  border-radius: 7px;
  background-color: var(--panel-hover);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  flex: 0 0 auto;
}

.cover-pick {
  cursor: pointer;
}

.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 15px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
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

.btn-accent:hover {
  filter: brightness(1.08);
}
</style>
