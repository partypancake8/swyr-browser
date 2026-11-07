// Renders resources/icon.svg to resources/icon.png (1024 px) and builds resources/icon.icns with iconutil.
// Usage: node scripts/make-icon.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const res = path.join(root, 'resources')
const svg = fs.readFileSync(path.join(res, 'icon.svg'))

const render = (size) =>
  sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 1024) * 2) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()

fs.writeFileSync(path.join(res, 'icon.png'), await render(1024))

// the standard macOS iconset: 16, 32, 128, 256 and 512 points at 1x and 2x
const sizes = [16, 32, 128, 256, 512]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-icon-'))
const iconset = path.join(dir, 'icon.iconset')
fs.mkdirSync(iconset)
for (const s of sizes) {
  fs.writeFileSync(path.join(iconset, `icon_${s}x${s}.png`), await render(s))
  fs.writeFileSync(path.join(iconset, `icon_${s}x${s}@2x.png`), await render(s * 2))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(res, 'icon.icns')], { stdio: 'inherit' })
fs.rmSync(dir, { recursive: true, force: true })
console.log('wrote resources/icon.png and resources/icon.icns')
