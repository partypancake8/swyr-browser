// The thumbnail of an empty canvas: a small PNG of a white board with a dot grid, made without a renderer, so a
// canvas has a thumbnail from the moment it is created (the canvas page replaces it with a picture of its scene).
import zlib from 'node:zlib'

export const BOARD_W = 320
export const BOARD_H = 200
const GRID = 20

let crcTable: Uint32Array | null = null
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** an RGB PNG of an empty board: white, a light dot every 20 px and a faint border */
export function blankBoardPng(width = BOARD_W, height = BOARD_H): Buffer {
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height, 0xff)
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1
      const dot = x % GRID === GRID / 2 && y % GRID === GRID / 2
      if (!edge && !dot) continue
      const v = edge ? 0xe4 : 0xc8
      const o = y * row + 1 + x * 3
      raw[o] = v
      raw[o + 1] = v
      raw[o + 2] = v
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let cached: string | null = null
/** the empty-board thumbnail as a data:image/png;base64 URL */
export function blankBoardDataUrl(): string {
  if (!cached) cached = `data:image/png;base64,${blankBoardPng().toString('base64')}`
  return cached
}
