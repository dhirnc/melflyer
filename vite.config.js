import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path, such as https://<user>.github.io/melflyer/.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
