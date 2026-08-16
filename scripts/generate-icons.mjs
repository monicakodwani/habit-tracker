// Generates the PWA / Add-to-Home-Screen PNG icons from the same mark as favicon.svg.
// Written by hand (zlib + a tiny PNG writer) so the repo needs no image-tooling dependency.
// Run with: npm run icons
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

const BG = [0x6f, 0x7a, 0x5a] // sage green
const FG = [0xfa, 0xf7, 0xf2] // warm off-white

/** Signed distance from point p to the line segment a->b. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Signed distance to a rounded rectangle covering the whole canvas. */
function distToRoundedRect(px, py, size, radius) {
  const half = size / 2
  const qx = Math.abs(px - half) - (half - radius)
  const qy = Math.abs(py - half) - (half - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * Renders the icon into a raw RGBA buffer.
 * `maskable` fills the full square (no transparent corners) so Android/iOS can crop it freely.
 */
function renderRGBA(size, maskable) {
  const buf = Buffer.alloc(size * size * 4)
  const s = size / 64 // design is authored on a 64x64 grid
  const radius = 15 * s
  // The checkmark is inset further on maskable icons to survive a safe-zone crop.
  const inset = maskable ? 0.72 : 1
  const c = size / 2
  const pt = (x, y) => [c + (x - 32) * s * inset, c + (y - 32) * s * inset]
  const [ax, ay] = pt(18, 33.5)
  const [bx, by] = pt(28, 43)
  const [cx, cy] = pt(46, 22)
  const strokeHalf = (7 * s * inset) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // Antialias by taking coverage from the distance field, one pixel wide.
      const bgCoverage = maskable ? 1 : clamp01(0.5 - distToRoundedRect(px, py, size, radius))
      const strokeDist = Math.min(
        distToSegment(px, py, ax, ay, bx, by),
        distToSegment(px, py, bx, by, cx, cy),
      )
      const fgCoverage = clamp01(strokeHalf - strokeDist + 0.5) * bgCoverage

      const i = (y * size + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        buf[i + ch] = Math.round(BG[ch] * (1 - fgCoverage) + FG[ch] * fgCoverage)
      }
      buf[i + 3] = Math.round(bgCoverage * 255)
    }
  }
  return buf
}

const clamp01 = (n) => Math.min(1, Math.max(0, n))

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData) >>> 0)
  return Buffer.concat([len, typeAndData, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function encodePNG(rgba, size) {
  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
const targets = [
  { name: 'icon-180.png', size: 180, maskable: false }, // apple-touch-icon
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
]
for (const { name, size, maskable } of targets) {
  writeFileSync(resolve(OUT_DIR, name), encodePNG(renderRGBA(size, maskable), size))
  console.log(`wrote icons/${name}`)
}
