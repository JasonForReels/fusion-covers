import { useState } from 'react'
import { loadManifest, loadTraktLists, loadTraktPopular } from '../lib/sources.js'
import { myLists, topLists, userLists, searchMany, CATEGORIES, SORTS, loadMdblistQuery, sourcesForList, mdblistPosters, aiometadataImportFile } from '../lib/mdblist.js'
import { useToast } from './Toast.jsx'

export default function SourcesPanel({ settings, setSettings, onAddCover, onAttach, onCreateRow, openSettings }) {
  const [tab, setTab] = useState('addon')
  return (
    <aside className="sources">
      <div className="tabs" role="tablist">
        {[['addon', 'Addon'], ['trakt', 'Trakt'], ['mdblist', 'MDBList'], ['custom', 'Custom']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'addon' && <AddonTab settings={settings} setSettings={setSettings} onAddCover={onAddCover} onAttach={onAttach} onCreateRow={onCreateRow} />}
      {tab === 'trakt' && <TraktTab settings={settings} onAddCover={onAddCover} onAttach={onAttach} openSettings={openSettings} />}
      {tab === 'mdblist' && <MdblistTab settings={settings} onAddCover={onAddCover} onAttach={onAttach} openSettings={openSettings} />}
      {tab === 'custom' && <CustomTab onAddCover={onAddCover} onAttach={onAttach} />}
    </aside>
  )
}

function ResultCard({ title, meta, warn, dataSource, onAddCover, onAttach }) {
  return (
    <div className="result">
      <div className="t">{title}</div>
      <div className="m">{meta}{warn && <span className="warntext"> · {warn}</span>}</div>
      <div className="b">
        <button onClick={() => onAddCover({ title, dataSource })}>+ Cover</button>
        {onAttach && <button className="ghost" onClick={() => onAttach(dataSource)}>Attach to selected</button>}
      </div>
    </div>
  )
}

function AddonTab({ settings, setSettings, onAddCover, onAttach, onCreateRow }) {
  const toast = useToast()
  const [url, setUrl] = useState(settings.aiometadataUrl || '')
  const [addon, setAddon] = useState(null)
  const [filter, setFilter] = useState('')
  const [origin, setOrigin] = useState('')
  const [picked, setPicked] = useState(new Set()) // group keys
  const [rowTitle, setRowTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(input = url) {
    if (!input.trim()) return
    setBusy(true)
    try {
      const a = await loadManifest(input)
      setAddon(a)
      setUrl(a.manifestUrl)
      setPicked(new Set())
      setFilter('')
      setOrigin('')
      setRowTitle(a.name)
      setSettings((s) => ({
        ...s,
        ...(a.isAiometadata ? { aiometadataUrl: a.manifestUrl } : {}),
        manifests: [{ url: a.manifestUrl, name: a.name }, ...s.manifests.filter((m) => m.url !== a.manifestUrl)].slice(0, 12),
      }))
      if (!a.catalogs.length) toast('That addon has no catalogs.', true)
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  const origins = addon ? [...new Set(addon.groups.map((g) => g.origin))] : []
  const shown = addon?.groups
    .filter((g) => !origin || g.origin === origin)
    .filter((g) => `${g.name} ${g.types.join(' ')} ${g.origin}`.toLowerCase().includes(filter.trim().toLowerCase())) ?? []
  const sourcesOf = (g) => g.catalogs.map((c) => c.dataSource)
  const chosen = addon?.groups.filter((g) => picked.has(g.key)) ?? []
  const allShownPicked = shown.length > 0 && shown.every((g) => picked.has(g.key))

  const toggle = (key) => setPicked((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleShown = () => setPicked((p) => { const n = new Set(p); shown.forEach((g) => (allShownPicked ? n.delete(g.key) : n.add(g.key))); return n })

  async function createRow() {
    setBusy(true)
    try {
      await onCreateRow({ title: rowTitle.trim() || addon.name, covers: chosen.map((g) => ({ title: g.name, dataSources: sourcesOf(g) })) })
      setPicked(new Set())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <form onSubmit={(e) => { e.preventDefault(); load() }}>
        <label>Addon manifest URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Your AIOMetadata …/manifest.json" autoComplete="off" spellCheck={false} />
        </label>
        <button className="primary block" disabled={busy}>{busy ? 'Loading…' : 'Load my lists'}</button>
      </form>
      <p className="hint">
        Paste your <b>AIOMetadata</b> (or any Stremio addon) manifest to pull in every list you've added to it, then tick the ones you
        want and create collections in one go. Fusion needs this URL, so it <b>will</b> be visible in your published JSON.
      </p>

      {settings.manifests.length > 0 && (
        <div className="chips">
          {settings.manifests.map((m) => (
            <span key={m.url} className="chipwrap">
              <button className="chip" title={m.url} onClick={() => load(m.url)}>{m.name}</button>
              <button className="chip x" aria-label={`Forget ${m.name}`} onClick={() => setSettings((s) => ({ ...s, manifests: s.manifests.filter((x) => x.url !== m.url) }))}>×</button>
            </span>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="pickbar">
          <b>{chosen.length} list{chosen.length > 1 ? 's' : ''} selected</b>
          <input value={rowTitle} placeholder="Collection row name" onChange={(e) => setRowTitle(e.target.value)} />
          <button className="primary" disabled={busy} onClick={createRow}>
            {busy ? 'Creating…' : `Create ${chosen.length} collection${chosen.length > 1 ? 's' : ''} in a new row`}
          </button>
          <div className="row2">
            <button className="ghost" disabled={busy} onClick={() => onAddCover({ title: chosen[0].name, dataSources: chosen.flatMap(sourcesOf) })}>Combine into 1 cover</button>
            <button className="ghost" disabled={busy || !onAttach} onClick={() => onAttach(chosen.flatMap(sourcesOf))}>Attach to selected</button>
          </div>
        </div>
      )}

      {addon && (
        <div className="results">
          <div className="group">{addon.name} · {addon.groups.length} lists</div>
          {addon.groups.length > 0 && (
            <div className="filters">
              <input placeholder="Filter lists…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              {origins.length > 1 && (
                <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Source">
                  <option value="">All sources</option>
                  {origins.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              <button type="button" className="ghost small" onClick={toggleShown}>{allShownPicked ? 'Clear' : `Select all${shown.length !== addon.groups.length ? ` ${shown.length}` : ''}`}</button>
            </div>
          )}
          {shown.map((g) => (
            <label key={g.key} className={`result pick ${picked.has(g.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.has(g.key)} onChange={() => toggle(g.key)} />
              <span>
                <span className="t">{g.name}</span>
                <span className="m">
                  {g.origin !== 'Other' ? `${g.origin} · ` : ''}{g.types.join(' + ')}
                  {g.requiresExtra && <span className="warntext"> · needs search — may be empty</span>}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

function TraktTab({ settings, onAddCover, onAttach, openSettings }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [lists, setLists] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(fn) {
    setBusy(true)
    try {
      setLists(await fn())
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  if (!settings.traktClientId) {
    return (
      <section>
        <p className="hint">
          Trakt requests use <b>your own</b> free API Client ID, so no shared key or login is involved.
          Create one at <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer noopener">trakt.tv/oauth/applications</a>{' '}
          (redirect URI: <code>urn:ietf:wg:oauth:2.0:oob</code>).
        </p>
        <button className="primary block" onClick={openSettings}>Add Client ID</button>
      </section>
    )
  }

  return (
    <section>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) run(() => loadTraktLists(query, settings.traktClientId)) }}>
        <label>Trakt username or list URL
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="snoak  or  trakt.tv/users/…/lists/…" autoComplete="off" spellCheck={false} />
        </label>
        <div className="row2">
          <button className="primary" disabled={busy}>Load</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => run(() => loadTraktPopular(settings.traktClientId))}>Popular lists</button>
        </div>
      </form>
      <p className="hint">Public lists only. Private lists need Fusion's own Trakt login anyway.</p>
      {lists && (
        <div className="results">
          {!lists.length && <p className="hint">No public lists found.</p>}
          {lists.map((l) => (
            <ResultCard
              key={l.key}
              title={l.name}
              meta={`@${l.owner} · ${l.count ?? '?'} items${l.likes ? ` · ♥ ${l.likes}` : ''}`}
              dataSource={l.dataSource}
              onAddCover={onAddCover}
              onAttach={onAttach}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function saveJson(name, value) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function MdblistTab({ settings, onAddCover, onAttach, openSettings }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [lists, setLists] = useState(null)
  const [picked, setPicked] = useState(new Map()) // id -> list
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingImport, setPendingImport] = useState(null)
  const [browse, setBrowse] = useState('search') // search | streaming | studios | users
  const [filter, setFilter] = useState('')
  const [mediatype, setMediatype] = useState('')
  const [owner, setOwner] = useState('')
  const [sort, setSort] = useState('popular')
  const key = settings.mdblistKey

  const owners = lists ? [...new Set(lists.map((l) => l.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : []
  const shown = (lists ?? [])
    .filter((l) => !mediatype || (mediatype === 'mixed' ? !['movie', 'show'].includes(l.mediatype) : l.mediatype === mediatype))
    .filter((l) => !owner || l.owner === owner)
    .filter((l) => `${l.name} ${l.owner}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort(SORTS[sort])

  async function run(fn) {
    setBusy(true)
    try {
      setLists(await fn())
      setOwner('')
      setFilter('')
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  function toggle(list) {
    setPicked((m) => {
      const next = new Map(m)
      next.has(list.id) ? next.delete(list.id) : next.set(list.id, list)
      if (!title && next.size === 1) setTitle(list.name)
      return next
    })
  }

  // Resolve every picked list to Fusion sources (Trakt mirror first, then AIOMetadata).
  async function resolvePicked() {
    let aiometadata = null
    if (settings.aiometadataUrl) {
      try {
        const m = await loadManifest(settings.aiometadataUrl)
        aiometadata = { url: m.manifestUrl, catalogIds: new Set(m.catalogs.map((c) => c.key)) }
      } catch (e) {
        aiometadata = { url: settings.aiometadataUrl, catalogIds: new Set() }
        toast(`Couldn't read your AIOMetadata manifest (${e.message}) — using it anyway.`, true)
      }
    }
    const all = []
    const missing = []
    let viaTrakt = 0
    for (const list of picked.values()) {
      const r = await sourcesForList(list, { traktClientId: settings.traktClientId, aiometadata })
      all.push(...r.sources)
      if (r.via === 'trakt') viaTrakt++
      if (r.missingInAddon) r.sources.forEach((s) => missing.push({ list, type: s.payload.type }))
    }
    setPendingImport(missing.length ? missing : null)
    return { all, viaTrakt, missing }
  }

  async function act(mode) {
    if (!picked.size) return
    setBusy(true)
    try {
      const { all, viaTrakt, missing } = await resolvePicked()
      const ids = [...picked.keys()]
      if (mode === 'cover') {
        await onAddCover({
          title: title.trim() || [...picked.values()][0].name,
          dataSources: all,
          loadPosters: async () => {
            const sets = await Promise.all(ids.map((id) => mdblistPosters(id, settings, 16).catch(() => [])))
            const mixed = []
            for (let i = 0; i < 16; i++) for (const s of sets) if (s[i] && mixed.length < 16) mixed.push(s[i])
            return mixed
          },
        })
      } else onAttach(all)
      const parts = [`${viaTrakt} via Trakt`, `${picked.size - viaTrakt} via addon`].filter((p) => !p.startsWith('0 '))
      toast(`${all.length} source${all.length > 1 ? 's' : ''} (${parts.join(', ')})${missing.length ? ' — some need adding to AIOMetadata' : ''}`, missing.length > 0)
      setPicked(new Map())
      setTitle('')
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  if (!key) {
    return (
      <section>
        <p className="hint">
          Browse MDBList lists with your own free API key from{' '}
          <a href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer noopener">mdblist.com/preferences</a>.
          Lists become Fusion sources through Trakt (when the list is mirrored there) or your AIOMetadata addon.
        </p>
        <button className="primary block" onClick={openSettings}>Add MDBList key</button>
      </section>
    )
  }

  return (
    <section>
      <div className="tabs sub" role="tablist">
        {[['search', 'Search'], ['streaming', 'Streaming'], ['studios', 'Studios'], ['users', 'Users']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={browse === id} className={`tab ${browse === id ? 'active' : ''}`} onClick={() => setBrowse(id)}>
            {label}
          </button>
        ))}
      </div>

      {(browse === 'search' || browse === 'users') && (
        <form onSubmit={(e) => {
          e.preventDefault()
          const q = query.trim()
          if (q) run(() => (browse === 'users' ? userLists(q.replace(/^@/, ''), key) : loadMdblistQuery(q, key)))
        }}>
          <label>{browse === 'users' ? 'MDBList username' : 'Username, list URL, or search'}
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={browse === 'users' ? 'e.g. garycrawfordgc' : 'disney plus  ·  mdblist.com/lists/…'} autoComplete="off" spellCheck={false} />
          </label>
          <div className="row3">
            <button className="primary" disabled={busy}>{browse === 'users' ? 'Load user' : 'Find'}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => run(() => myLists(key))}>My lists</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => run(() => topLists(key))}>Most popular</button>
          </div>
          {browse === 'users' && <p className="hint">Load “Most popular” and use the curator filter below to browse by user.</p>}
        </form>
      )}

      {CATEGORIES[browse] && (
        <div className="chips">
          <button className="chip" disabled={busy} onClick={() => run(() => searchMany(CATEGORIES[browse], key))}>
            All {browse === 'studios' ? 'studios' : 'services'}
          </button>
          {CATEGORIES[browse].map((name) => (
            <button key={name} className="chip" disabled={busy} onClick={() => run(() => searchMany([name], key))}>{name}</button>
          ))}
        </div>
      )}

      {picked.size > 0 && (
        <div className="pickbar">
          <b>{picked.size} list{picked.size > 1 ? 's' : ''} selected</b>
          <input value={title} placeholder="Cover title" onChange={(e) => setTitle(e.target.value)} />
          <div className="row2">
            <button className="primary" disabled={busy} onClick={() => act('cover')}>+ Cover</button>
            <button className="ghost" disabled={busy || !onAttach} onClick={() => act('attach')}>Attach</button>
          </div>
        </div>
      )}

      {pendingImport && (
        <div className="pickbar warnbox">
          <span className="hint">These lists aren't in your AIOMetadata addon yet, so Fusion will show them empty until you add them.</span>
          <button className="block" onClick={() => saveJson('aiometadata-mdblist-catalogs.json', aiometadataImportFile(pendingImport))}>
            Download AIOMetadata import file
          </button>
        </div>
      )}

      {lists && (
        <div className="results">
          {lists.length > 0 && (
            <div className="filters">
              <input placeholder="Filter lists…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                <option value="popular">Most popular</option>
                <option value="items">Most items</option>
                <option value="name">A–Z</option>
              </select>
              <select value={mediatype} onChange={(e) => setMediatype(e.target.value)} aria-label="Type">
                <option value="">All types</option>
                <option value="movie">Movies</option>
                <option value="show">Shows</option>
                <option value="mixed">Mixed</option>
              </select>
              {owners.length > 1 && (
                <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Curator">
                  <option value="">All curators ({owners.length})</option>
                  {owners.map((o) => <option key={o} value={o}>@{o}</option>)}
                </select>
              )}
            </div>
          )}
          {busy && <p className="hint">Loading…</p>}
          {!shown.length && <p className="hint">No lists found.</p>}
          {lists.length > 0 && shown.length !== lists.length && <div className="group">{shown.length} of {lists.length} lists</div>}
          {shown.map((l) => (
            <label key={l.key} className={`result pick ${picked.has(l.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l)} />
              <span>
                <span className="t">{l.name}</span>
                <span className="m">
                  {l.owner ? `@${l.owner} · ` : ''}{l.mediatype || 'mixed'} · {l.count ?? '?'} items{l.likes ? ` · ♥ ${l.likes}` : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

const CUSTOM_EXAMPLE = '{"kind":"addonCatalog","payload":{"addonId":"https://v3-cinemeta.strem.io/manifest.json","catalogId":"movie::top","type":"movie"}}'

function CustomTab({ onAddCover, onAttach }) {
  const toast = useToast()
  const [text, setText] = useState(CUSTOM_EXAMPLE)
  const [title, setTitle] = useState('Custom')

  function parse() {
    try {
      const v = JSON.parse(text)
      const arr = Array.isArray(v) ? v : [v]
      if (!arr.every((d) => d && typeof d.kind === 'string' && typeof d.payload === 'object')) throw new Error()
      return arr
    } catch {
      toast('Expected {"kind": "...", "payload": {...}} or an array of those.', true)
      return null
    }
  }

  return (
    <section>
      <p className="hint">Paste any Fusion data source object (or array) for sources this tool doesn't browse yet, e.g. PMDB or MDBList.</p>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Data source JSON<textarea rows={9} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="row2">
        <button className="primary" onClick={() => { const a = parse(); if (a) a.forEach((ds) => onAddCover({ title, dataSource: ds })) }}>+ Cover</button>
        <button className="ghost" disabled={!onAttach} onClick={() => { const a = parse(); if (a) a.forEach((ds) => onAttach(ds)) }}>Attach</button>
      </div>
    </section>
  )
}
