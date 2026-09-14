import { useEffect, useRef, useState } from 'react'
import { buildExport, parseExport, validate } from '../lib/fusion.js'
import { renderToBlob } from '../lib/render.js'
import { publish, ensureRepo, currentUser } from '../lib/github.js'
import { startGithubLogin, githubLoginAvailable } from '../lib/githubAuth.js'
import { loadToken, saveToken, wipeEverything } from '../lib/storage.js'
import { useToast } from './Toast.jsx'
import { hostingAvailable, newHost, publishHosted, hostedUrl } from '../lib/hosting.js'
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
  const [user, setUser] = useState(null)
  const [advanced, setAdvanced] = useState(false)
  const [loginEnabled, setLoginEnabled] = useState(false)
  useEffect(() => {
    githubLoginAvailable().then((ok) => {
      setLoginEnabled(ok)
      if (!ok) setAdvanced(true) // no sign-in on this server: show the token option directly
    })
  }, [])
  const [remember, setRemember] = useState(settings.rememberToken)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(settings.lastUrl || '')
  const [needsRepo, setNeedsRepo] = useState(null)
  const [mode, setMode] = useState(hostingAvailable() ? settings.publishTo ?? 'covers' : 'github')
  const hosted = mode === 'covers'
  const problems = validate(project)
  const append = (line) => setLog((l) => [...l, line])

  // Who is signed in? Fills the owner automatically.
  useEffect(() => {
    if (!token) return setUser(null)
    let live = true
    currentUser(token)
      .then((u) => {
        if (!live) return
        setUser(u)
        setGh((g) => ({ ...g, owner: g.owner || u.login, repo: g.repo || 'my-fusion-covers', branch: g.branch || 'main', dir: g.dir ?? 'fusion' }))
      })
      .catch(() => live && setUser(null))
    return () => {
      live = false
    }
  }, [token])

  const ready = gh.owner && gh.repo && token && !problems.length

  function signOut() {
    saveToken('', false)
    setToken('')
    setUser(null)
    toast('Signed out on this device')
  }

  async function renderAll(type, ext, quality) {
    const items = project.rows.flatMap((r) => r.items)
    const images = []
    for (const [i, item] of items.entries()) {
      append(`Rendering cover ${i + 1}/${items.length}…`)
      images.push({ id: item.id, name: `${item.id.toLowerCase()}.${ext}`, blob: await renderToBlob(item, settings, type, quality) })
    }
    return images
  }

  async function goHosted() {
    setBusy(true)
    setLog([])
    setResult('')
    const host = settings.host ?? newHost()
    setSettings((s) => ({ ...s, host, publishTo: 'covers' }))
    try {
      // JPEG keeps hosted covers small (free-tier storage); covers are opaque so nothing is lost.
      const images = await renderAll('image/jpeg', 'jpg', 0.9)
      const { url, urlFor } = await publishHosted(host, images, (urlFor) => buildExport(project, urlFor), append)
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

  async function go() {
    if (hosted) return goHosted()
    setBusy(true)
    setLog([])
    setResult('')
    setNeedsRepo(null)
    if (advanced) saveToken(token, remember)
    setSettings((s) => ({ ...s, github: gh, rememberToken: remember, publishTo: 'github' }))
    try {
      const repo = await ensureRepo(gh, token, append)
      const target = { ...gh, branch: repo.created ? repo.defaultBranch : gh.branch || repo.defaultBranch }
      if (repo.created) setGh(target)
      const images = await renderAll('image/png', 'png')
      const { url, urlFor } = await publish(target, token, images, (urlFor) => buildExport(project, urlFor), append)
      onPublished?.(urlFor)
      setResult(url)
      setSettings((s) => ({ ...s, github: target, lastUrl: url }))
    } catch (e) {
      if (e.needsRepo) setNeedsRepo(e.needsRepo)
      const msg = e.needsRepo ? e.message : e.status === 403 || e.status === 404
        ? `${e.message} — make sure you can write to ${gh.owner}/${gh.repo}.`
        : e.message
      append(`✕ ${msg}`)
      toast(msg, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Publish"
      onClose={onClose}
      actions={
        <>
          <button className="ghost" onClick={() => saveFile('config.json', JSON.stringify(buildExport(project), null, 2))}>Download JSON</button>
          {(hosted || token) && <button className="primary" disabled={(hosted ? problems.length > 0 : !ready) || busy} onClick={go}>{busy ? 'Publishing…' : 'Publish'}</button>}
        </>
      }
    >
      {hostingAvailable() && (
        <div className="seg">
          <button type="button" className={hosted ? 'on' : ''} onClick={() => { setMode('covers'); setResult('') }}>Host for me (easiest)</button>
          <button type="button" className={!hosted ? 'on' : ''} onClick={() => { setMode('github'); setResult('') }}>My GitHub repo</button>
        </div>
      )}

      {problems.length > 0 && <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      {hosted ? (
        <>
          <p className="hint">
            No account needed. Covers and <code>config.json</code> are hosted for free and you get one permanent link to paste into
            Fusion. Re-publishing updates the same link. Anyone with the link can view it; only this browser (and your synced
            devices) can change it. Links Fusion hasn't opened for 180 days are removed.
          </p>
          {settings.host && !result && (
            <p className="hint">Your link: <code>{hostedUrl(settings.host)}</code></p>
          )}
        </>
      ) : (<>
      <p className="hint">
        Covers and <code>config.json</code> go into a public repo on <b>your</b> GitHub account, so you own everything. Fusion reads it from there.
      </p>

      {!token ? (
        <div className="signin">
          {loginEnabled && (
            <button className="primary block big" onClick={startGithubLogin}>Sign in with GitHub</button>
          )}
          <p className="hint">
            No GitHub account? <a href="https://github.com/signup" target="_blank" rel="noreferrer noopener">Create one free</a>, then come back.
            We create a repo for you and publish — nothing else is touched.
          </p>
          {loginEnabled && (
            <button className="ghost small" onClick={() => setAdvanced((v) => !v)}>{advanced ? 'Hide' : 'Use a personal access token instead'}</button>
          )}
        </div>
      ) : (
        <div className="signedin">
          {user?.avatar && <img src={user.avatar} alt="" />}
          <span>Signed in as <b>@{user?.login ?? '…'}</b></span>
          <button className="ghost small" onClick={signOut}>Sign out</button>
        </div>
      )}

      {(token || advanced) && (
        <div className="grid2">
          <label>Repository name<input value={gh.repo} placeholder="my-fusion-covers" onChange={(e) => setGh({ ...gh, repo: e.target.value.trim().replace(/\s+/g, '-') })} /></label>
          <label>Owner<input value={gh.owner} placeholder="your-username" onChange={(e) => setGh({ ...gh, owner: e.target.value.trim() })} /></label>
          <label>Branch<input value={gh.branch} onChange={(e) => setGh({ ...gh, branch: e.target.value.trim() })} /></label>
          <label>Folder<input value={gh.dir} placeholder="(repo root)" onChange={(e) => setGh({ ...gh, dir: e.target.value.trim() })} /></label>
        </div>
      )}
      {token && <p className="hint">If the repo doesn't exist yet it's created (public) on first publish.</p>}

      {advanced && !token && (
        <>
          <label>Fine-grained access token
            <input type="password" autoComplete="off" placeholder="github_pat_…" onChange={(e) => setToken(e.target.value.trim())} />
          </label>
          <p className="hint">
            Most private option: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">create a token</a> limited
            to one existing repo with <i>Contents: Read and write</i>. To let us create the repo for you, give it
            <i>All repositories</i> with <i>Administration</i> and <i>Contents: Read and write</i>.
          </p>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember token on this device
          </label>
        </>
      )}

      </>)}

      {log.length > 0 && <div className="log">{log.join('\n')}</div>}
      {needsRepo && (
        <div className="brandbox">
          <p className="hint">
            Personal access tokens usually can't create repositories. Create it on GitHub in one click, give your token
            access to it (<i>Repository access</i> › add <b>{needsRepo.repo}</b>, <i>Contents: Read and write</i>), then publish again.
            Or sign out and use <b>Sign in with GitHub</b>, which creates the repo automatically.
          </p>
          <div className="keyrow">
            <a className="button primary" href={`https://github.com/new?name=${encodeURIComponent(needsRepo.repo)}&owner=${encodeURIComponent(needsRepo.owner)}&visibility=public&description=${encodeURIComponent('Fusion collection covers')}`} target="_blank" rel="noreferrer noopener">Create {needsRepo.repo} on GitHub</a>
            <a className="button" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer noopener">Edit token access</a>
            <button type="button" disabled={busy} onClick={go}>I've done it — publish</button>
          </div>
        </div>
      )}
      {result && (
        <>
          <label>Your Fusion JSON URL</label>
          <CopyUrl url={result} />
          <p className="hint">In Fusion: Settings › Widgets › Add New › Collections Row › Import JSON. Re-publishing updates the same URL{hosted ? ' (Fusion may take a minute to see changes)' : ' (GitHub may cache for ~5 minutes)'}.</p>
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

      <div className="grid2">
        <label>MDBList API key
          <input value={settings.mdblistKey ?? ''} autoComplete="off" spellCheck={false} placeholder="From mdblist.com/preferences"
            onChange={(e) => save({ mdblistKey: e.target.value.trim() })} />
        </label>
        <label>AIOMetadata manifest URL
          <input value={settings.aiometadataUrl ?? ''} autoComplete="off" spellCheck={false} placeholder="https://…/manifest.json"
            onChange={(e) => save({ aiometadataUrl: e.target.value.trim() })} />
        </label>
      </div>
      <p className="hint">
        MDBList lists are added as Trakt sources when mirrored on Trakt, otherwise through your AIOMetadata addon.
        Note: your AIOMetadata URL will appear in published JSON, like any addon URL.
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
