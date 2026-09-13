import { useEffect, useRef, useState } from 'react'
import { renderCover } from '../lib/render.js'

export default function CoverCanvas({ item, settings, className, onMissing }) {
  const ref = useRef(null)
  const [missing, setMissing] = useState([])

  useEffect(() => {
    let cancelled = false
    // Draw offscreen, then blit, so a slow image load never shows a half-drawn cover.
    const off = document.createElement('canvas')
    renderCover(off, item, { useImageProxy: settings.useImageProxy }).then(({ missing }) => {
      if (cancelled || !ref.current) return
      const c = ref.current
      c.width = off.width
      c.height = off.height
      c.getContext('2d').drawImage(off, 0, 0)
      setMissing(missing)
    })
    return () => {
      cancelled = true
    }
  }, [item.aspect, item.title, item.design, settings.useImageProxy])

  useEffect(() => onMissing?.(missing), [missing, onMissing])

  return <canvas ref={ref} className={className} />
}
