import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Matches Tauri's documented Vite integration; a busy port must fail visibly.
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2021' },
})
