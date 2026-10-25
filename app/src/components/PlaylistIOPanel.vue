<script setup lang="ts">
/**
 * 歌单导入 / 导出面板（S6）—— 走剪贴板，不走原生文件对话框。
 *
 * 为什么是剪贴板：原生 showSaveDialog / showOpenDialog 需要新的 IPC，
 * 而 electron/ 归 S4 那一路，本阶段不能碰。格式与校验都在 core/playlistIO.ts 里，
 * 将来接上文件对话框时，这里只要把 textarea 换成文件读写即可，格式层一行不改。
 *
 * 失败与残缺**必须逐条列出**（不是一句"导入失败"）：用户要能知道是哪一首坏了。
 */
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import type { Song } from '../data/normalize';
import {
  exportPlaylistJSON,
  importPlaylistJSON,
  summarizeImport,
  type ImportIssue,
  type ImportedPlaylist,
} from '../core/playlistIO';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** 导出模式：传入歌单内容；导入模式忽略 */
    mode: 'export' | 'import';
    playlistName?: string;
    playlistDescription?: string;
    playlistCover?: string;
    songs?: readonly Song[];
  }>(),
  {
    playlistName: '',
    playlistDescription: '',
    playlistCover: '',
    songs: () => [],
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'imported', playlist: ImportedPlaylist): void;
}>();

const text = ref('');
const issues = ref<ImportIssue[]>([]);
const notice = ref('');
/**
 * 解析成功但有待确认的提示时，**先不导入**。
 *
 * 踩到的坑：残缺数据解析成功就直接 emit 关闭面板，用户根本看不到那几条提示
 * （"第 2 首缺少 id 已跳过"），于是以为歌全都进来了。
 * 所以有 warning 时把结果挂在这里，按钮变成"确认导入 N 首"，用户看过再点。
 */
const pending = ref<ImportedPlaylist | null>(null);

const textSummary = computed(() => {
  if (props.mode === 'export') {
    return '已生成 ' + String(props.songs.length) + ' 首的 JSON（重复或缺 id 的歌不会导出）';
  }
  return '把导出的 JSON 粘到下面';
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    issues.value = [];
    notice.value = '';
    pending.value = null;
    text.value = props.mode === 'export'
      ? exportPlaylistJSON({
        name: props.playlistName,
        description: props.playlistDescription,
        cover: props.playlistCover,
        songs: props.songs,
      })
      : '';
  },
  { immediate: true },
);

async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value);
    notice.value = '已复制到剪贴板（' + String(text.value.length) + ' 字符）';
  } catch (err) {
    // 剪贴板被浏览器策略拒绝时退回"手动全选"——不能让用户无路可走
    notice.value = '复制失败（' + (err instanceof Error ? err.message : String(err)) + '）：请手动全选文本框内容复制';
  }
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const value = await navigator.clipboard.readText();
    if (!value) {
      notice.value = '剪贴板是空的';
      return;
    }
    text.value = value;
    notice.value = '已从剪贴板读取 ' + String(value.length) + ' 字符';
  } catch (err) {
    notice.value = '读取剪贴板失败（' + (err instanceof Error ? err.message : String(err)) + '）：请手动粘贴到文本框';
  }
}

function parse(): void {
  const result = importPlaylistJSON(text.value);
  issues.value = result.issues;
  notice.value = summarizeImport(result);
  if (!result.ok) {
    pending.value = null;
    return;
  }
  const warnings = result.issues.filter((i) => i.level === 'warning');
  if (warnings.length === 0) {
    // 干净数据：直接导入
    emit('imported', result.playlist);
    return;
  }
  // 有残缺：留在面板里让用户先看清提示
  pending.value = result.playlist;
}

/** 用户看过提示后的二次确认 */
function confirmPending(): void {
  const target = pending.value;
  if (!target) return;
  pending.value = null;
  emit('imported', target);
}

function download(): void {
  // 兜底通道：Blob 下载不需要任何 IPC，浏览器能力就够
  const blob = new Blob([text.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (props.playlistName || 'playlist') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  notice.value = '已通过浏览器下载保存（' + String(text.value.length) + ' 字符）';
}
</script>

<template>
  <div v-if="open" class="mask" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-modal="true" data-testid="io-panel">
      <header class="io-head">
        <h3 class="io-title">{{ mode === 'export' ? '导出歌单' : '导入歌单' }} · {{ playlistName || '(未命名)' }}</h3>
        <button type="button" class="io-close" title="关闭" @click="emit('close')">
          <Icon name="close" :size="14" />
        </button>
      </header>

      <p class="io-hint">{{ textSummary }}</p>

      <div class="io-actions">
        <button
          v-if="mode === 'export'"
          type="button"
          class="io-btn"
          data-testid="io-copy"
          @click="copyToClipboard"
        >
          复制到剪贴板
        </button>
        <button v-if="mode === 'export'" type="button" class="io-btn" @click="download">另存为 .json</button>
        <button
          v-if="mode === 'import'"
          type="button"
          class="io-btn"
          data-testid="io-paste"
          @click="pasteFromClipboard"
        >
          从剪贴板粘贴
        </button>
        <button
          v-if="mode === 'import' && !pending"
          type="button"
          class="io-btn io-btn-accent"
          data-testid="io-parse"
          @click="parse"
        >
          解析并导入
        </button>
        <button
          v-if="mode === 'import' && pending"
          type="button"
          class="io-btn io-btn-accent"
          data-testid="io-confirm"
          @click="confirmPending"
        >
          确认导入 {{ pending.songs.length }} 首
        </button>
      </div>

      <textarea
        v-model="text"
        class="io-text"
        data-testid="io-text"
        spellcheck="false"
        :readonly="mode === 'export'"
        placeholder="{ &quot;kind&quot;: &quot;netease-desktop/playlist&quot;, ... }"
      />

      <p v-if="notice" class="io-notice" data-testid="io-notice">{{ notice }}</p>

      <ul v-if="issues.length > 0" class="io-issues" data-testid="io-issues">
        <li
          v-for="(issue, i) in issues"
          :key="i"
          class="io-issue"
          :class="issue.level === 'error' ? 'is-error' : 'is-warn'"
        >
          <span class="io-badge">{{ issue.level === 'error' ? '错误' : '提示' }}</span>
          <span class="io-issue-text">{{ issue.message }}</span>
        </li>
      </ul>
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
  z-index: 115;
}

.panel {
  width: 620px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  padding: 16px 18px 14px;
  border-radius: var(--radius);
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow-pop);
}

.io-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.io-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.io-close {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.io-close:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.io-hint {
  margin: 8px 0 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.io-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.io-btn {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 14px;
  background: var(--panel-hover);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.io-btn:hover {
  background: var(--item-hover);
  color: var(--text-strong);
}

.io-btn-accent {
  background: var(--accent);
  color: var(--text-on-accent);
}

.io-btn-accent:hover {
  background: var(--accent);
  filter: brightness(1.08);
}

.io-text {
  flex: 1;
  min-height: 180px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-bg);
  color: var(--text);
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  user-select: text;
}

.io-text:focus {
  border-color: var(--accent);
}

.io-notice {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}

.io-issues {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.io-issue {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  font-size: 11px;
  line-height: 1.6;
}

.io-issue-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.io-badge {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
}

.io-issue.is-error .io-badge {
  background: var(--accent);
  color: var(--text-on-accent);
}

.io-issue.is-error .io-issue-text {
  color: var(--text-strong);
}

.io-issue.is-warn .io-badge {
  background: var(--panel-hover);
  color: var(--text-muted);
}

.io-issue.is-warn .io-issue-text {
  color: var(--text-muted);
}
</style>
