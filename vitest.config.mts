import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app/src', import.meta.url)),
    },
  },
  test: {
    include: [
      'app/src/**/*.test.ts',
      'electron/services/__tests__/*.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**'],
  },
});
