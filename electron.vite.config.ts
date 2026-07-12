import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'archive/project-archive-import-worker': resolve(__dirname, 'electron/main/archive/project-archive-import-worker.ts')
        },
        external: ['@node-rs/jieba', '@node-rs/jieba/dict.js'],
        output: {
          entryFileNames: '[name].js'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron/shared')
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist-electron/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron/shared')
      }
    }
  },
  renderer: {
    root: 'renderer',
    server: {
      host: '127.0.0.1'
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'renderer/index.html')
      }
    },
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'renderer/src'),
        '@shared': resolve(__dirname, 'electron/shared')
      }
    }
  }
})
