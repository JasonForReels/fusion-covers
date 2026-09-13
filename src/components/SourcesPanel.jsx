import { useState } from 'react'
import { loadManifest, loadTraktLists, loadTraktPopular } from '../lib/sources.js'
import { useToast } from './Toast.jsx'

export default function SourcesPanel({ settings, setSettings, onAddCover, onAttach, openSettings }) {
  const [tab, setTab] = useState('addon')
  return (
    <aside className="sources">
      <div className="tabs" role="tablist">
        {[['addon', 'Stremio addon'], ['trakt', 'Trakt'], ['custom', 'Custom']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'addon' && <AddonTab settings={settings} setSettings={setSettings} onAddCover={onAddCover} onAttach={onAttach} />}
      {tab === 'trakt' && <TraktTab settings={settings} onAddCover={onAddCover} onAttach={onAttach} openSettings={openSettings} />}
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

function AddonTab({ settings, setSettings, onAddCover, onAttach }) {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [addon, setAddon] = useState(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(input = url) {
    if (!input.trim()) return
    setBusy(true)
    try {
      const a = await loadManifest(input)
      setAddon(a)
      setUrl(a.manifestUrl)
      setSettings((s) => ({
        ...s,
        manifests: [{ url: a.manifestUrl, name: a.name }, ...s.manifests.filter((m) => m.url !== a.manifestUrl)].slice(0, 12),
      }))
      if (!a.catalogs.length) toast('That addon has no catalogs.', true)
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  const catalogs = addon?.catalogs.filter((c) => `${c.name} ${c.type}`.toLowerCase().includes(filter.toLowerCase())) ?? []

  return (
    <section>
      <form onSubmit={(e) => { e.preventDefault(); load() }}>
        <label>Manifest URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/manifest.json" autoComplete="off" spellCheck={false} />
        </label>
        <button className="primary block" disabled={busy}>{busy ? 'Loading…' : 'Load catalogs'}</button>
      </form>
      <p className="hint">Fetched directly by your browser. Fusion needs this URL, so it <b>will</b> be visible in your published JSON — avoid manifests with secrets in a public repo.</p>

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

      {addon && (
        <div className="results">
          <div className="group">{addon.name} · {addon.catalogs.length} catalogs</div>
          {addon.catalogs.length > 8 && <input placeholder="Filter catalogs…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          {catalogs.map((c) => (
            <ResultCard
              key={c.key}
              title={c.name}
              meta={c.type}
              warn={c.requiresExtra ? 'needs search/extra — may be empty' : null}
              dataSource={c.dataSource}
              onAddCover={onAddCover}
              onAttach={onAttach}
            />
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
