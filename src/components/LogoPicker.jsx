import { useRef, useState } from 'react'
import { LOGOS, logoById } from '../lib/logos.js'
import { useToast } from './Toast.jsx'

function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

// Darken a brand hex for a gradient partner color.
function shade(hex, f = 0.25) {
  const n = parseInt(hex.slice(1), 16)
  const c = (s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0')
  return `#${c(16)}${c(8)}${c(0)}`
}

export default function LogoPicker({ logo, setLogo, setColors, newLogo, onPreset }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(!!logo)
  const preset = logo?.preset ? logoById(logo.preset) : null
  const update = (fields) => setLogo({ ...(logo ?? newLogo()), ...fields })

  function upload(file) {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return toast('Logo files must be under 2 MB.', true)
    const reader = new FileReader()
    // SVG/PNG kept as-is (transparency matters for logos).
    reader.onload = () => update({ preset: '', src: reader.result })
    reader.readAsDataURL(file)
  }

  const shown = LOGOS.filter((l) => l.title.toLowerCase().includes(filter.toLowerCase()))

  return (
    <fieldset>
      <legend>Logo</legend>
      {!open ? (
        <button type="button" className="block" onClick={() => setOpen(true)}>+ Add a logo</button>
      ) : (
        <>
          <input placeholder="Search logos…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="logogrid">
            <button type="button" className={`logo-btn ${!logo ? 'on' : ''}`} title="No logo" onClick={() => setLogo(null)}>∅</button>
            {shown.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.title}
                className={`logo-btn ${logo?.preset === l.id ? 'on' : ''}`}
                onClick={() => {
                  update({ preset: l.id, src: '', ...(logo?.preset !== l.id && l.defaultTint ? { tint: l.defaultTint } : {}) })
                  if (logo?.preset !== l.id) onPreset?.(l)
                }}
              >
                {l.src ? (
                  <img src={l.src} alt="" className="logo-img" />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={l.path} fill={l.hex === '#000000' ? '#e8ebf3' : l.hex} /></svg>
                )}
              </button>
            ))}
          </div>
          <p className="hint">
            Not listed (Prime Video, Hulu, Peacock, studios…)? Pick it under Background › Posters, then “Use as logo” — or upload a PNG/SVG.
          </p>
          <label>Logo URL
            <input
              value={logo?.src?.startsWith('data:') ? '(uploaded file)' : (logo?.src ?? '')}
              placeholder="https://…/logo.svg"
              onChange={(e) => update({ preset: '', src: e.target.value.trim() })}
            />
          </label>
          <button type="button" className="block" onClick={() => fileRef.current.click()}>Upload logo file</button>
          <input ref={fileRef} type="file" accept="image/png,image/svg+xml,image/webp" hidden onChange={(e) => upload(e.target.files[0])} />

          {logo && (logo.preset || logo.src) && (
            <>
              <label>Color
                <Seg value={logo.tint} options={[['original', 'Original'], ['white', 'White'], ['custom', 'Custom']]} onChange={(tint) => update({ tint })} />
              </label>
              <div className="swatches">
                {['#ffffff', '#000000', preset?.hex, '#f5c518', '#e50914', '#7c5cff', '#20c997'].filter(Boolean).map((c) => (
                  <button key={c} type="button" title={c} className={`swatch ${logo.tint === 'custom' && logo.color === c ? 'on' : ''}`}
                    style={{ background: c }} onClick={() => update({ tint: 'custom', color: c })} />
                ))}
              </div>
              {logo.tint === 'custom' && <label>Logo color<input type="color" value={logo.color} onChange={(e) => update({ color: e.target.value })} /></label>}
              <label>Size {Math.round(logo.scale * 100)}%
                <input type="range" min="0.3" max="2.5" step="0.05" value={logo.scale} onChange={(e) => update({ scale: +e.target.value })} />
              </label>
              <label>Position
                <Seg value={logo.pos} options={[['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]} onChange={(pos) => update({ pos })} />
              </label>
              {preset && (
                <button type="button" className="block" onClick={() => {
                  const hex = preset.hex === '#000000' ? '#2a2a2a' : preset.hex
                  setColors(hex, shade(hex))
                }}>
                  Use {preset.title} brand colors
                </button>
              )}
            </>
          )}
        </>
      )}
    </fieldset>
  )
}
