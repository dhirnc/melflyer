import { defineConfig } from 'vite';

// Relative base so the build works from the site root or any sub-path.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
