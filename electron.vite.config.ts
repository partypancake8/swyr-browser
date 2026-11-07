import { resolve } from 'node:path'
import fs from 'node:fs'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const r = (p: string): string => resolve(__dirname, p)

// round 3b: the canvas page's fonts ship with the app (served at swyr://canvas/excalidraw-assets/), never from a CDN
const EXCALIDRAW_FONTS = r('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
function excalidrawAssets(): Plugin {
  let outDir = ''
  return {
    name: 'swyr-excalidraw-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/excalidraw-assets/fonts', (req, res, next) => {
        const file = resolve(EXCALIDRAW_FONTS, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]))
        if (!file.startsWith(EXCALIDRAW_FONTS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next()
        res.setHeader('content-type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (outDir && fs.existsSync(EXCALIDRAW_FONTS)) fs.cpSync(EXCALIDRAW_FONTS, resolve(outDir, 'excalidraw-assets/fonts'), { recursive: true })
    }
  }
}

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
    plugins: [react(), tailwindcss(), excalidrawAssets()],
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
          // round 3b
          note: r('src/renderer/pages/note/index.html'),
          canvas: r('src/renderer/pages/canvas/index.html')
        }
      }
    }
  }
})
