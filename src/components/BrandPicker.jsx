import { useEffect, useState } from 'react'
import { imageLogoForBrand } from '../lib/logos.js'
import { listProviders, searchCompanies, NETWORKS, STUDIOS, IMG } from '../lib/tmdb.js'

const KINDS = [
  ['provider', 'Streaming'],
  ['network', 'TV network'],
  ['company', 'Studio'],
]

export default function BrandPicker({ brand, busy, settings, onPick, onUseLogo, onCatalog, hasCatalog }) {
  const [kind, setKind] = useState(brand?.kind ?? 'provider')
  const [query, setQuery] = useState('')
  const [providers, setProviders] = useState([])
  const [companies, setCompanies] = useState(null)
  const [error, setError] = useState('')
  const [showExtra, setShowExtra] = useState(false)
  const key = settings.tmdbKey

  useEffect(() => {
    if (kind !== 'provider' || !key) return
    let live = true
    listProviders(settings.region, key)
      .then((p) => live && (setProviders(p), setError('')))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [kind, key, settings.region])

  // Debounced TMDB company search; curated studios show when the box is empty.
  useEffect(() => {
    if (kind !== 'company' || !key || query.trim().length < 2) return setCompanies(null)
    const t = setTimeout(() => {
      searchCompanies(query.trim(), key).then(setCompanies).catch((e) => setError(e.message))
    }, 350)
    return () => clearTimeout(t)
  }, [kind, key, query])

  if (!key) {
    return (
      <div className="brandbox">
        <p className="hint">
          To fill posters with real titles from a streaming service, TV network or studio, add a free TMDB API key in
          Settings (<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer noopener">themoviedb.org/settings/api</a>).
        </p>
      </div>
    )
  }

  const q = query.toLowerCase()
  const options =
    kind === 'provider'
      ? providers.filter((p) => (showExtra || !p.extra) && p.name.toLowerCase().includes(q)).slice(0, 80)
      : kind === 'network'
        ? NETWORKS.filter((n) => n.name.toLowerCase().includes(q))
        : (companies ?? STUDIOS.filter((s) => s.name.toLowerCase().includes(q)))

  // Bundled wordmarks (e.g. Netflix) replace TMDB's provider/network icons.
  const logoSrc = (o) => imageLogoForBrand(o)?.src ?? (o.logo ? IMG(o.logo, 'w92') : null)
  const isCurrent = (o) => brand && brand.kind === o.kind && brand.id === o.id

  return (
    <div className="brandbox">
      <label>Posters from</label>
      {brand && (
        <div className="brandnow">
          {logoSrc(brand) ? <img src={logoSrc(brand)} alt="" /> : null}
          <span><b>{brand.name}</b> <span className="muted">· {KINDS.find((k) => k[0] === brand.kind)?.[1]}</span></span>
          {logoSrc(brand) && <button type="button" className="small" onClick={onUseLogo}>Use as logo</button>}
          <button type="button" className="small" disabled={busy} onClick={() => onPick(brand)}>↻</button>
        </div>
      )}
      <div className="seg">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setQuery(''); setError('') }}>{label}</button>
        ))}
      </div>
      <input
        placeholder={kind === 'provider' ? `Search services in ${settings.region}…` : kind === 'network' ? 'Filter networks…' : 'Search any studio…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {kind === 'provider' && (
        <label className="check small">
          <input type="checkbox" checked={showExtra} onChange={(e) => setShowExtra(e.target.checked)} />
          Show rent/buy stores and add-on channels
        </label>
      )}
      {busy && <p className="hint">Checking which titles actually stream there…</p>}
      {error && <p className="hint warntext">{error}</p>}
      <div className="brandlist">
        {options.map((o) => (
          <button key={`${o.kind}${o.id}`} type="button" disabled={busy} className={`brandopt ${isCurrent(o) ? 'on' : ''}`} onClick={() => onPick(o)}>
            {logoSrc(o) ? <img src={logoSrc(o)} alt="" loading="lazy" /> : <span className="nologo" />}
            <span>{o.name}{o.country ? <span className="muted"> · {o.country}</span> : null}</span>
          </button>
        ))}
        {kind === 'company' && companies?.length === 0 && <p className="hint">No studios match.</p>}
      </div>
      {hasCatalog && (
        <button type="button" className="ghost small" disabled={busy} onClick={onCatalog}>Use posters from this cover's catalog instead</button>
      )}
    </div>
  )
}
