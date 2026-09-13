import { useCallback, useRef, useState } from 'react'
import { ASPECTS, describeSource, defaultDesign, newLogo } from '../lib/fusion.js'
import LogoPicker from './LogoPicker.jsx'
import BrandPicker from './BrandPicker.jsx'
import { brandPosters, brandDetails, resolveBrandHint, IMG } from '../lib/tmdb.js'
import { addonPosters, traktPosters } from '../lib/sources.js'
import { FONTS, canvasToBlob } from '../lib/render.js'
import CoverCanvas from './CoverCanvas.jsx'
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

export default function Editor({ item, patch, onRemove, onDuplicate, onClose, settings }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const wrapRef = useRef(null)
  const [missing, setMissing] = useState([])
  const d = item.design
  const set = (fields) => patch((it) => ({ ...it, ...fields }))
  const setD = (fields) => patch((it) => ({ ...it, design: { ...it.design, ...fields } }))
  const onMissing = useCallback((m) => setMissing(m), [])
  const [busy, setBusy] = useState(false)

  async function fillFromBrand(brand) {
    setBusy(true)
    try {
      const [posters, full] = await Promise.all([
        brandPosters(brand, settings.region, settings.tmdbKey),
        brandDetails(brand, settings.tmdbKey).catch(() => brand),
      ])
      setD({ bg: 'collage', posters, brand: full })
      toast(`Posters from ${full.name}`)
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  // Picking a built-in streaming/network logo pulls that brand's titles automatically.
  async function onPresetLogo(preset) {
    if (!preset.brand) return
    if (!settings.tmdbKey) return toast(`Add a TMDB key in Settings to fill posters with ${preset.title} titles.`)
    try {
      const brand = await resolveBrandHint(preset.brand, settings.region, settings.tmdbKey)
      if (brand) await fillFromBrand(brand)
      else toast(`${preset.title} isn't available in ${settings.region} on TMDB — pick a brand under Posters.`, true)
    } catch (e) {
      toast(e.message, true)
    }
  }

  async function fillFromCatalog() {
    const ds = item.dataSources[0]
    setBusy(true)
    try {
      const posters =
        ds.kind === 'addonCatalog'
          ? await addonPosters(ds.payload.addonId, ds.payload.type ?? ds.payload.catalogType, ds.payload.catalogId)
          : await traktPosters(ds.payload, settings.traktClientId)
      if (!posters.length) throw new Error('That catalog returned no posters.')
      setD({ bg: 'collage', posters, brand: null })
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  function uploadImage(file) {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) toast('Large image — it will be downscaled when rendering.', false)
    const reader = new FileReader()
    reader.onload = () => {
      // Downscale + re-encode to keep local storage and sync small.
      const img = new Image()
      img.onload = () => {
        // Covers render at ≤990px, so 1000px is plenty. WebP keeps synced/stored data small.
        const scale = Math.min(1, 1000 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        setD({ bg: 'image', image: c.toDataURL('image/webp', 0.8) })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  async function downloadPng() {
    try {
      const blob = await canvasToBlob(wrapRef.current.querySelector('canvas'))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${item.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'cover'}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) {
      toast(e.message, true)
    }
  }

  return (
    <aside className="editor">
      <div className="editor-head">
        <b>Edit cover</b>
        <button className="icon" aria-label="Close editor" onClick={onClose}>✕</button>
      </div>

      <div ref={wrapRef}>
        <CoverCanvas item={item} settings={settings} className="preview" onMissing={onMissing} />
      </div>
      {missing.length > 0 && (
        <p className="hint warntext">
          Couldn't load {missing.join(' & ')} (host blocks browser access). Upload the image, or enable the image proxy in Settings.
        </p>
      )}

      <div className="form">
        <label>Title<input value={item.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Shape<Seg value={item.aspect} options={Object.entries(ASPECTS).map(([k, v]) => [k, v.label])} onChange={(aspect) => set({ aspect })} /></label>
        <label className="check">
          <input type="checkbox" checked={!item.hideTitle} onChange={(e) => set({ hideTitle: !e.target.checked })} />
          Also show Fusion's own title label
        </label>

        <fieldset>
          <legend>Background</legend>
          <Seg value={d.bg} options={[['gradient', 'Gradient'], ['solid', 'Solid'], ['collage', 'Posters'], ['image', 'Image']]} onChange={(bg) => setD({ bg })} />
          <div className="grid2">
            <label>Color 1<input type="color" value={d.c1} onChange={(e) => setD({ c1: e.target.value })} /></label>
            {d.bg !== 'solid' && <label>Color 2<input type="color" value={d.c2} onChange={(e) => setD({ c2: e.target.value })} /></label>}
          </div>
          {d.bg !== 'solid' && (
            <label>Angle {d.angle}°<input type="range" min="0" max="360" value={d.angle} onChange={(e) => setD({ angle: +e.target.value })} /></label>
          )}
          {d.bg === 'image' && (
            <>
              <label>Image URL
                <input
                  value={d.image.startsWith('data:') ? '(uploaded image)' : d.image}
                  placeholder="https://…"
                  onChange={(e) => setD({ image: e.target.value })}
                />
              </label>
              <button type="button" className="block" onClick={() => fileRef.current.click()}>Upload from device</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadImage(e.target.files[0])} />
            </>
          )}
          {d.bg === 'collage' && (
            <>
              <BrandPicker
                brand={d.brand ?? null}
                busy={busy}
                settings={settings}
                onPick={fillFromBrand}
                onUseLogo={() => setD({ logo: { ...newLogo(), ...(d.logo ?? {}), preset: '', src: IMG(d.brand.logo, 'w500'), tint: d.brand.kind === 'provider' ? 'original' : 'white', scale: d.brand.kind === 'provider' ? 0.7 : 1 } })}
                hasCatalog={['addonCatalog', 'traktList'].includes(item.dataSources[0]?.kind)}
                onCatalog={fillFromCatalog}
              />
              <details>
                <summary className="hint">Edit poster URLs manually</summary>
                <textarea rows={4} spellCheck={false} value={d.posters.join('\n')} onChange={(e) => setD({ brand: null, posters: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
              </details>
            </>
          )}
          {(d.bg === 'image' || d.bg === 'collage') && (
            <label>Color tint {Math.round(d.dim * 100)}%<input type="range" min="0" max="0.95" step="0.05" value={d.dim} onChange={(e) => setD({ dim: +e.target.value })} /></label>
          )}
        </fieldset>

        <LogoPicker onPreset={onPresetLogo} logo={d.logo ?? null} setLogo={(logo) => setD({ logo })} setColors={(c1, c2) => setD({ c1, c2 })} newLogo={newLogo} />

        <fieldset>
          <legend>Text</legend>
          <label className="check"><input type="checkbox" checked={d.text} onChange={(e) => setD({ text: e.target.checked })} />Draw title on cover</label>
          {d.text && (
            <>
              <div className="grid2">
                <label>Font
                  <select value={d.font} onChange={(e) => setD({ font: e.target.value })}>
                    {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                  </select>
                </label>
                <label>Weight
                  <select value={d.weight} onChange={(e) => setD({ weight: +e.target.value })}>
                    {[400, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
                <label>Color<input type="color" value={d.color} onChange={(e) => setD({ color: e.target.value })} /></label>
                <label>Size {Math.round(d.size * 100)}%<input type="range" min="0.4" max="2" step="0.05" value={d.size} onChange={(e) => setD({ size: +e.target.value })} /></label>
              </div>
              <label>Position<Seg value={d.pos} options={[['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]} onChange={(pos) => setD({ pos })} /></label>
              <label className="check"><input type="checkbox" checked={d.uppercase} onChange={(e) => setD({ uppercase: e.target.checked })} />UPPERCASE</label>
              <label className="check"><input type="checkbox" checked={d.shadow} onChange={(e) => setD({ shadow: e.target.checked })} />Shadow</label>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Data sources ({item.dataSources.length})</legend>
          {!item.dataSources.length && <p className="hint warntext">Fusion needs at least one. Use “Attach to selected” on the left.</p>}
          {item.dataSources.map((ds, i) => {
            const { label, detail } = describeSource(ds)
            return (
              <div className="ds" key={i}>
                <div>
                  <div>{label}</div>
                  <code>{ds.kind} · {detail}</code>
                </div>
                <button className="icon danger" aria-label="Remove source" onClick={() => set({ dataSources: item.dataSources.filter((_, j) => j !== i) })}>✕</button>
              </div>
            )
          })}
        </fieldset>

        <div className="row3">
          <button onClick={downloadPng}>PNG</button>
          <button onClick={onDuplicate}>Duplicate</button>
          <button onClick={() => setD({ ...defaultDesign(), posters: d.posters, logo: d.logo, bg: d.posters.length ? 'collage' : 'gradient' })}>Reset style</button>
        </div>
        <button className="danger block" onClick={onRemove}>Delete cover</button>
      </div>
    </aside>
  )
}
