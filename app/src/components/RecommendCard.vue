<script setup lang="ts">
/**
 * 推荐卡片（S5）：方形封面 + 标题 + 副标题，整块可点。
 *
 * 与旧 HomeView 里内联的 grid-card 的差别：
 *  - 封面尺寸自适应容器（不写死 132），横滑列表与网格都能用；
 *  - 右上角可挂一个角标（榜单用"更新频率"，歌单用播放量）；
 *  - 卡片本身是 <button>，键盘可聚焦，不需要额外 tabindex。
 */
import Cover from './Cover.vue';

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    cover?: string;
    /** 右上角小角标 */
    badge?: string;
    /** 圆形封面（歌手/电台用） */
    round?: boolean;
    fallbackIcon?: 'music' | 'album' | 'artist';
  }>(),
  { subtitle: '', cover: '', badge: '', round: false, fallbackIcon: 'album' },
);

const emit = defineEmits<{ (e: 'open'): void }>();
</script>

<template>
  <button type="button" class="rec-card" @click="emit('open')">
    <div class="rc-cover-wrap" :class="{ round }">
      <Cover :src="cover" :size="0" :radius="round ? 999 : 8" :fallback-icon="fallbackIcon" />
      <span v-if="badge" class="rc-badge">{{ badge }}</span>
    </div>
    <div class="rc-title s3-truncate">{{ title }}</div>
    <div v-if="subtitle" class="rc-sub s3-truncate">{{ subtitle }}</div>
  </button>
</template>

<style scoped>
.rec-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  min-width: 0;
}

.rc-cover-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
}

.rc-cover-wrap.round {
  border-radius: 999px;
  overflow: hidden;
}

/* Cover.vue 的尺寸由 size 属性内联，这里用 :deep 覆盖成撑满容器 */
.rc-cover-wrap :deep(.cover) {
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit;
}

.rc-badge {
  position: absolute;
  right: 5px;
  bottom: 5px;
  padding: 1px 6px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.62);
  color: var(--text-strong);
  font-size: 10px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.rc-title {
  font-size: 12px;
  color: var(--text-strong);
  line-height: 1.35;
}

.rec-card:hover .rc-title {
  color: var(--accent);
}

.rc-sub {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
