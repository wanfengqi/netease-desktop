<script setup lang="ts">
/**
 * 区块标题（S5）：标题 + 可选副标题 + 可选"刷新/更多"槽位。
 *
 * 单独抽出来的理由：首页有 4-5 个区块，标题样式必须一致；
 * 每个区块自带重试按钮的话，样式会各写一遍并逐渐漂移。
 */
withDefaults(
  defineProps<{
    title: string;
    /** 右侧灰字说明，例如 "10 个歌单" */
    hint?: string;
    /** 关掉底部间距（用于最后一个区块） */
    tight?: boolean;
  }>(),
  { hint: '', tight: false },
);
</script>

<template>
  <div class="section-header" :class="{ tight }">
    <h3>{{ title }}</h3>
    <span v-if="hint" class="sh-hint">{{ hint }}</span>
    <span class="sh-spacer" />
    <slot name="action" />
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.section-header.tight {
  margin-bottom: 0;
}

.section-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}

.sh-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.sh-spacer {
  flex: 1;
}
</style>
