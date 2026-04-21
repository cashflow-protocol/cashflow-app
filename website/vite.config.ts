import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Multi-entry build so /family gets its own HTML with route-specific OG tags
      // (social crawlers don't run JS — they read the initial HTML response only).
      input: {
        main: resolve(__dirname, 'index.html'),
        family: resolve(__dirname, 'family.html'),
      },
    },
  },
});
