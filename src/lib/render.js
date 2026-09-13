import { ASPECTS } from './fusion.js'
import { logoById } from './logos.js'

// Covers are drawn on a <canvas> in the browser. Images must allow CORS or the canvas becomes
// "tainted" and can't be exported. Hosts like metahub/trakt don't send CORS headers, so those
// posters are skipped unless the user opts in to the images.weserv.nl proxy in Settings.

export const FONTS = {
  sans: { label: 'Sans', stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: 'Serif', stack: 'ui-serif, Georgia, "Times New Roman", serif' },
  rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", sans-serif' },
  condensed: { label: 'Condensed', stack: '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif' },
  mono: { label: 'Mono', stack: 'ui-monospace, Menlo, Consolas, monospace' },
}

const cache = new Map()

const proxied = (src) => `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=600&output=jpg`

function loadOne(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function loadImage(src, { useImageProxy = false } = {}) {
  if (!src) return Promise.resolve(null)
  const key = `${useImageProxy}|${src}`
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const direct = await loadOne(src)
        if (direct || !useImageProxy || src.startsWith('data:') || src.startsWith('blob:')) return direct
        return loadOne(proxied(src))
      })(),
    )
  }
  return cache.get(key)
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function gradient(ctx, W, H, c1, c2, angle) {
  const a = (angle * Math.PI) / 180
  const r = Math.hypot(W, H) / 2
  const g = ctx.createLinearGradient(
    W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r,
    W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r,
  )
  g.addColorStop(0, c1)
  g.addColorStop(1, c2)
  return g
}

function drawCollage(ctx, W, H, images) {
  const tileW = Math.round(Math.min(W, H) * 0.34)
  const tileH = Math.round(tileW * 1.5)
  const gap = Math.round(tileW * 0.06)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((-12 * Math.PI) / 180)
  const cols = Math.ceil((W * 1.6) / (tileW + gap)) + 1
  const rows = Math.ceil((H * 1.6) / (tileH + gap)) + 1
  let n = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const img = images[n++ % images.length]
      const x = (c - cols / 2) * (tileW + gap) + (r % 2 ? tileW / 2 : 0)
      const y = (r - rows / 2) * (tileH + gap)
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(x, y, tileW, tileH, tileW * 0.06)
      ctx.clip()
      drawCover(ctx, img, x, y, tileW, tileH)
      ctx.restore()
    }
  }
  ctx.restore()
}

// Recolor a transparent PNG/SVG logo to a single flat color. Fully opaque images (e.g. square app
// icons) would just become a solid block, so those are drawn as-is.
const opaqueCache = new WeakMap()
function isOpaque(img) {
  if (!opaqueCache.has(img)) {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(img, 0, 0, 32, 32)
    let opaque = true
    try {
      const a = x.getImageData(0, 0, 32, 32).data
      for (let i = 3; i < a.length; i += 4) if (a[i] < 250) { opaque = false; break }
    } catch {
      opaque = false
    }
    opaqueCache.set(img, opaque)
  }
  return opaqueCache.get(img)
}

function tinted(img, color) {
  if (isOpaque(img)) return img
  const c = document.createElement('canvas')
  c.width = img.naturalWidth || img.width
  c.height = img.naturalHeight || img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  x.globalCompositeOperation = 'source-in'
  x.fillStyle = color
  x.fillRect(0, 0, c.width, c.height)
  return c
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

export async function renderCover(canvas, item, opts = {}) {
  const { width: W, height: H } = ASPECTS[item.aspect] ?? ASPECTS.wide
  const d = item.design
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const missing = []

  // Load everything first so we draw in one synchronous pass (no flicker on re-render).
  const bgImage = d.bg === 'image' ? await loadImage(d.image, opts) : null
  const posters =
    d.bg === 'collage' ? (await Promise.all(d.posters.map((p) => loadImage(p, opts)))).filter(Boolean) : []
  if (d.bg === 'image' && d.image && !bgImage) missing.push('background image')
  if (d.bg === 'collage' && d.posters.length && !posters.length) missing.push('posters')
  let logo = null
  if (d.logo?.preset) logo = logoById(d.logo.preset) ?? null
  else if (d.logo?.src) {
    const img = await loadImage(d.logo.src, opts)
    if (img) logo = { img }
    else missing.push('logo')
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = d.bg === 'solid' ? d.c1 : gradient(ctx, W, H, d.c1, d.c2, d.angle)
  ctx.fillRect(0, 0, W, H)

  if (bgImage) drawCover(ctx, bgImage, 0, 0, W, H)
  if (posters.length) drawCollage(ctx, W, H, posters)

  if ((bgImage || posters.length) && d.dim > 0) {
    ctx.fillStyle = gradient(ctx, W, H, d.c1, d.c2, d.angle)
    ctx.globalAlpha = Math.min(0.95, d.dim)
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
  }

  // Logo and title are laid out as blocks; blocks sharing a position stack (logo above title).
  const blocks = { top: [], center: [], bottom: [] }
  const shadow = (blur) => {
    if (!d.shadow) return
    ctx.shadowColor = 'rgba(0,0,0,.55)'
    ctx.shadowBlur = blur
    ctx.shadowOffsetY = blur * 0.18
  }

  if (logo) {
    const l = d.logo
    const fill = l.tint === 'custom' ? l.color : l.tint === 'white' ? '#ffffff' : null
    if (logo.path) {
      const side = Math.min(W, H) * 0.3 * l.scale
      blocks[l.pos].push({
        h: side,
        draw: (y) => {
          ctx.save()
          shadow(side * 0.12)
          ctx.translate((W - side) / 2, y)
          ctx.scale(side / 24, side / 24)
          ctx.fillStyle = fill ?? logo.hex
          ctx.fill(new Path2D(logo.path))
          ctx.restore()
        },
      })
    } else {
      const s = Math.min((W * 0.62 * l.scale) / logo.img.width, (H * 0.34 * l.scale) / logo.img.height)
      const w = logo.img.width * s
      const h = logo.img.height * s
      blocks[l.pos].push({
        h,
        draw: (y) => {
          ctx.save()
          shadow(Math.min(w, h) * 0.12)
          if (isOpaque(logo.img)) {
            ctx.beginPath()
            ctx.roundRect((W - w) / 2, y, w, h, Math.min(w, h) * 0.18)
            ctx.clip()
          }
          ctx.drawImage(fill ? tinted(logo.img, fill) : logo.img, (W - w) / 2, y, w, h)
          ctx.restore()
        },
      })
    }
  }

  if (d.text && item.title.trim()) {
    const text = d.uppercase ? item.title.toUpperCase() : item.title
    let size = Math.min(W, H) * 0.16 * d.size
    const maxW = W * 0.84
    const maxH = H * (logo && d.logo.pos === d.pos ? 0.45 : 0.8)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const font = () => `${d.weight} ${size}px ${FONTS[d.font]?.stack ?? FONTS.sans.stack}`
    let lines
    // Shrink until the title fits in at most 3 lines and the box.
    for (;;) {
      ctx.font = font()
      lines = wrapLines(ctx, text, maxW)
      const tooWide = lines.some((l) => ctx.measureText(l).width > maxW)
      if ((lines.length <= 3 && !tooWide && lines.length * size * 1.08 < maxH) || size < 14) break
      size *= 0.92
    }
    const lineH = size * 1.08
    blocks[d.pos].push({
      h: lines.length * lineH,
      draw: (y) => {
        ctx.save()
        ctx.font = font()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        shadow(size * 0.35)
        ctx.fillStyle = d.color
        lines.forEach((l, i) => ctx.fillText(l, W / 2, y + lineH * (i + 0.5)))
        ctx.restore()
      },
    })
  }

  const gap = Math.min(W, H) * 0.05
  for (const [pos, list] of Object.entries(blocks)) {
    if (!list.length) continue
    const total = list.reduce((a, b) => a + b.h, 0) + gap * (list.length - 1)
    let y = pos === 'top' ? H * 0.1 : pos === 'bottom' ? H * 0.9 - total : (H - total) / 2
    for (const b of list) {
      b.draw(y)
      y += b.h + gap
    }
  }

  return { missing }
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed.'))), 'image/png')
    } catch {
      reject(new Error('An image without CORS permission tainted the canvas. Enable the image proxy or upload the image.'))
    }
  })
}

export async function renderToBlob(item, opts) {
  const canvas = document.createElement('canvas')
  await renderCover(canvas, item, opts)
  return canvasToBlob(canvas)
}
