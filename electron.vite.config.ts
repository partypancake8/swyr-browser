import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const r = (p: string): string => resolve(__dirname, p)

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: r('src/main/index.ts') } }
    },
    resolve: { alias: { '@shared': r('src/shared') } }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: r('src/preload/index.ts'), page: r('src/preload/page.ts'), mini: r('src/preload/mini.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    },
    resolve: { alias: { '@shared': r('src/shared') } }
  },
  renderer: {
    root: r('src/renderer'),
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@shared': r('src/shared'), '@renderer': r('src/renderer') } },
    build: {
      rollupOptions: {
        input: {
          shell: r('src/renderer/shell/index.html'),
          overlay: r('src/renderer/overlay/index.html'),
          mini: r('src/renderer/mini/index.html'),
          newtab: r('src/renderer/pages/newtab/index.html'),
          settings: r('src/renderer/pages/settings/index.html'),
          archive: r('src/renderer/pages/archive/index.html'),
          library: r('src/renderer/pages/library/index.html'),
          extensions: r('src/renderer/pages/extensions/index.html'),
          // round 3a
          history: r('src/renderer/pages/history/index.html'),
          styles: r('src/renderer/pages/styles/index.html')
        }
      }
    }
  }
})
