import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Club-layer scoring is the same arithmetic wherever it runs, so the
      // what-if calculator on the fixtures page imports the server's own pure
      // domain modules rather than keeping a second copy that can drift from
      // the one the season is actually scored with. Nothing under here may
      // reach for a database, a clock or a node builtin.
      '@domain': fileURLToPath(new URL('../server/src/domain', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
