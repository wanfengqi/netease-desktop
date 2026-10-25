<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <section class="placeholder">
    <h2>{{ title }}</h2>
    <slot />
  </section>
</template>

<style scoped>
.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px;
  text-align: center;
  color: var(--text);
  font-size: 13px;
}

.placeholder h2 {
  margin: 0 0 14px;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-strong);
  opacity: 0.9;
}
</style>
