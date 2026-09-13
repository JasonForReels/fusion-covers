import { useEffect, useRef, useState } from 'react'
import { buildExport, parseExport, validate } from '../lib/fusion.js'
import { renderToBlob } from '../lib/render.js'
import { publish, checkRepo } from '../lib/github.js'
import { loadToken, saveToken, wipeEverything } from '../lib/storage.js'
import { useToast } from './Toast.jsx'
import { cleanKey, testKey } from '../lib/tmdb.js'

function Modal({ title, onClose, children, actions }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    el.showModal()
    return () => el.close()
  }, [])
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose() }} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dlg">
        <h2>{title}</h2>
        {children}
        <div className="dlg-actions">
          {actions}
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  )
}

function saveFile(name, text, type = 'application/json') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function CopyUrl({ url }) {
  const toast = useToast()
  return (
    <div className="urlbox">
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button
        className="primary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            toast('Copied')
          } catch {
            toast('Clipboard blocked — select and copy manually.', true)
          }
        }}
      >
        Copy
      </button>
    </div>
  )
}

/* ---------------- Publish ---------------- */

export function PublishDialog({ project, settings, setSettings, onPublished, onClose }) {
  const toast = useToast()
  const [gh, setGh] = useState(settings.github)
  const [token, setToken] = useState(loadToken)
  const [remember, setRemember] = useState(settings.rememberToken)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(settings.lastUrl || '')
  const problems = validate(project)

  const append = (line) => setLog((l) => [...l, line])
  const ready = gh.owner && gh.repo && gh.branch && token && !problems.length

  async function go() {
    setBusy(true)
    setLog([])
    setResult('')
    saveToken(token, remember)
    setSettings((s) => ({ ...s, github: gh, rememberToken: remember }))
    try {
      const repo = await checkRepo(gh, token)
      if (!repo.canPush) throw new Error('This token cannot write to that repo. It needs Contents: Read and write.')
      const items = project.rows.flatMap((r) => r.items)
      const images = []
      for (const [i, item] of items.entries()) {
        append(`Rendering cover ${i + 1}/${items.length}…`)
        images.push({ id: item.id, name: `${item.id.toLowerCase()}.png`, blob: await renderToBlob(item, settings) })
      }
      const { url, urlFor } = await publish(gh, token, images, (urlFor) => buildExport(project, urlFor), append)
      onPublished?.(urlFor)
      setResult(url)
      setSettings((s) => ({ ...s, lastUrl: url }))
    } catch (e) {
      append(`✕ ${e.message}`)
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Publish to your GitHub"
      onClose={onClose}
      actions={
        <>
          <button className="ghost" onClick={() => saveFile('config.json', JSON.stringify(buildExport(project), null, 2))}>Download JSON</button>
          <button className="primary" disabled={!ready || busy} onClick={go}>{busy ? 'Publishing…' : 'Publish'}</button>
        </>
      }
    >
      <p className="hint">
        Covers and <code>config.json</code> are committed straight from your browser to <b>your</b> repo, in one commit.
        No third-party server ever sees your token, sources or images. The repo must be <b>public</b> so Fusion can read it.
      </p>

      {problems.length > 0 && (
        <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      <div className="grid2">
        <label>Owner<input value={gh.owner} placeholder="your-username" onChange={(e) => setGh({ ...gh, owner: e.target.value.trim() })} /></label>
        <label>Repository<input value={gh.repo} placeholder="fusion-covers" onChange={(e) => setGh({ ...gh, repo: e.target.value.trim() })} /></label>
        <label>Branch<input value={gh.branch} onChange={(e) => setGh({ ...gh, branch: e.target.value.trim() })} /></label>
        <label>Folder<input value={gh.dir} placeholder="(repo root)" onChange={(e) => setGh({ ...gh, dir: e.target.value.trim() })} /></label>
      </div>

      <label>Fine-grained access token
        <input type="password" value={token} autoComplete="off" placeholder="github_pat_…" onChange={(e) => setToken(e.target.value.trim())} />
      </label>
      <p className="hint">
        Create one at{' '}
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">github.com/settings/personal-access-tokens</a>:{' '}
        <i>Only select repositories</i> → pick this repo → <i>Repository permissions → Contents: Read and write</i>. Nothing else.
        Need a repo? <a href="https://github.com/new" target="_blank" rel="noreferrer noopener">Create a public one</a>.
      </p>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember token on this device (otherwise it's forgotten when you close the tab)
      </label>

      {log.length > 0 && <div className="log">{log.join('\n')}</div>}
      {result && (
        <>
          <label>Your Fusion JSON URL</label>
          <CopyUrl url={result} />
          <p className="hint">In Fusion: Settings › Widgets › Add New › Collections Row › Import JSON. Re-publishing updates the same URL (GitHub may cache for ~5 minutes).</p>
        </>
      )}
    </Modal>
  )
}

/* ---------------- Settings ---------------- */

export function SettingsDialog({ settings, setSettings, onClose }) {
  const [clientId, setClientId] = useState(settings.traktClientId)
  const [tmdbKey, setTmdbKey] = useState(cleanKey(settings.tmdbKey))
  const [keyStatus, setKeyStatus] = useState(null) // { ok, text }

  async function checkKey() {
    setKeyStatus({ ok: null, text: 'Testing…' })
    try {
      const key = await testKey(tmdbKey)
      setTmdbKey(key)
      save({ tmdbKey: key })
      setKeyStatus({ ok: true, text: 'Key works ✓' })
    } catch (e) {
      setKeyStatus({ ok: false, text: e.message })
    }
  }
  const save = (fields) => setSettings((s) => ({ ...s, ...fields }))

  return (
    <Modal title="Settings" onClose={onClose}>
      <label>Trakt Client ID
        <input value={clientId} autoComplete="off" spellCheck={false} placeholder="From trakt.tv/oauth/applications"
          onChange={(e) => setClientId(e.target.value.trim())} onBlur={() => save({ traktClientId: clientId })} />
      </label>
      <p className="hint">
        Make a free app at <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer noopener">trakt.tv/oauth/applications</a>{' '}
        (redirect URI <code>urn:ietf:wg:oauth:2.0:oob</code>). Only the public Client ID is used; the secret is never needed.
      </p>

      <div className="grid2">
        <label>TMDB API key
          <input value={tmdbKey} autoComplete="off" spellCheck={false} placeholder="API key or read token"
            onChange={(e) => { setTmdbKey(e.target.value); setKeyStatus(null) }}
            onFocus={(e) => e.target.select()}
            onBlur={() => { const k = cleanKey(tmdbKey); setTmdbKey(k); save({ tmdbKey: k }) }} />
        </label>
        <label>Region (for streaming)
          <input value={settings.region} maxLength={2} placeholder="US"
            onChange={(e) => save({ region: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
        </label>
      </div>
      <div className="keyrow">
        <button type="button" disabled={!tmdbKey} onClick={checkKey}>Test TMDB key</button>
        {tmdbKey && <button type="button" className="ghost" onClick={() => { setTmdbKey(''); save({ tmdbKey: '' }); setKeyStatus(null) }}>Clear</button>}
        {keyStatus && <span className={keyStatus.ok ? 'oktext' : keyStatus.ok === false ? 'warntext' : 'muted'}>{keyStatus.text}</span>}
      </div>
      <p className="hint">
        Paste either the “API Key” or the “API Read Access Token”.
        Used to fill collages with titles from a streaming service, TV network or studio. Free key at{' '}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer noopener">themoviedb.org/settings/api</a>. Requests go straight to TMDB.
      </p>

      <label className="check">
        <input type="checkbox" checked={settings.useImageProxy} onChange={(e) => save({ useImageProxy: e.target.checked })} />
        Use images.weserv.nl proxy for posters that block browser access
      </label>
      <p className="hint">Off by default. When on, poster URLs that fail to load directly are fetched through that third-party service.</p>

      <fieldset>
        <legend>Your data</legend>
        <p className="hint">Projects, settings and tokens live only in this browser's storage. There are no accounts, cookies, or analytics.</p>
        <div className="row2">
          <button onClick={() => saveFile('covers-backup.json', localStorage.getItem('covers.project.v1') ?? '{}')}>Back up project</button>
          <button
            className="danger"
            onClick={() => {
              if (!confirm('Erase all projects, settings and saved tokens from this browser?')) return
              wipeEverything()
              location.reload()
            }}
          >
            Erase everything
          </button>
        </div>
      </fieldset>
      <button className="primary block" onClick={() => { save({ traktClientId: clientId, tmdbKey: cleanKey(tmdbKey), region: settings.region || 'US' }); onClose() }}>Save</button>
    </Modal>
  )
}

/* ---------------- Import ---------------- */

export function ImportDialog({ onImport, onClose }) {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const fileRef = useRef(null)

  function accept(json) {
    try {
      if (json?.exportType) return onImport(parseExport(json))
      if (Array.isArray(json?.rows)) return onImport(json) // project backup
      throw new Error('Unrecognised file — expected a Fusion export or a Covers backup.')
    } catch (e) {
      toast(e.message, true)
    }
  }

  async function fromUrl() {
    try {
      const res = await fetch(url.trim(), { credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      accept(await res.json())
    } catch (e) {
      toast(e instanceof TypeError ? 'That host blocks browser requests. Open the URL, save the file, then use “Choose file…” or paste it.' : `Couldn't fetch: ${e.message}`, true)
    }
  }

  return (
    <Modal title="Import" onClose={onClose}>
      <p className="hint">Load an existing Fusion collections JSON (from here, covers.betterer.cc, or anywhere) or a project backup. This replaces the current project.</p>
      <label>From URL</label>
      <div className="urlbox">
        <input value={url} placeholder="https://…/config.json" onChange={(e) => setUrl(e.target.value)} />
        <button className="primary" disabled={!url.trim()} onClick={fromUrl}>Fetch</button>
      </div>
      <label>Or paste JSON<textarea rows={6} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="row2">
        <button disabled={!text.trim()} onClick={() => { try { accept(JSON.parse(text)) } catch { toast('Invalid JSON', true) } }}>Import pasted</button>
        <button onClick={() => fileRef.current.click()}>Choose file…</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden
        onChange={async (e) => { const f = e.target.files[0]; if (f) try { accept(JSON.parse(await f.text())) } catch { toast('Invalid JSON file', true) } }} />
    </Modal>
  )
}
