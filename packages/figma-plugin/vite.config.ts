import { resolve } from 'path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

const root = import.meta.dirname;

// https://vitejs.dev/config/
export default defineConfig({
  root: resolve(root, 'src/ui'),
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(root, 'src/ui/ui.html'),
    },
  },
});
