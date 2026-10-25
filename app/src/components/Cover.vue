<script setup lang="ts">
/**
 * 封面图（S3）：懒加载 + 失败占位。
 *
 * 两个坑：
 *  1. 网易云/咪咕的封面 url 可能是 http 或空串，直接当 img src 会产生一堆 404；
 *     loading="lazy" 让视口外的图根本不去请求。
 *  2. 失败时不能留一个破图 —— 换成音符占位，视觉上仍然对齐。
 */
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    src?: string;
    /** 无图时显示的图标 */
    fallbackIcon?: 'music' | 'album' | 'artist';
    size?: number;
    radius?: number;
  }>(),
  { src: '', fallbackIcon: 'music', size: 44, radius: 6 },
);

const broken = ref(false);

watch(
  () => props.src,
  () => {
    broken.value = false;
  },
);

const showImage = computed(() => Boolean(props.src) && !broken.value);
</script>

<template>
  <div
    class="cover"
    :style="{ width: size + 'px', height: size + 'px', borderRadius: radius + 'px' }"
  >
    <img
      v-if="showImage"
      :src="src"
      :alt="''"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="broken = true"
    />
    <div v-else class="cover-fallback">
      <Icon :name="fallbackIcon" :size="Math.max(14, Math.round(size * 0.42))" />
    </div>
  </div>
</template>

<style scoped>
.cover {
  flex: 0 0 auto;
  overflow: hidden;
  background: var(--panel-hover);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-fallback {
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
