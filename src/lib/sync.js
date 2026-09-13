// End-to-end encrypted sync with a single copy/paste token.
//
// token (fc1_…, 256 random bits)
//   ├─ HKDF "covers/id"    → vault id        (what the server stores it under)
//   ├─ HKDF "covers/write" → write secret    (server keeps only its SHA-256)
//   └─ HKDF "covers/enc"   → AES-256-GCM key (never leaves the browser)
//
// The server sees ciphertext only. Anyone holding the token has full access, so it is the account.

import { mergeProjects, mergeSettings, pickSynced } from './merge.js'

export const SYNC_URL = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/+$/, '')
const STATE_KEY = 'covers.sync.v1'
const PREFIX = 'fc1_'
const POLL_MS = 60_000
const PUSH_DEBOUNCE_MS = 4000 // batches bursts of edits into one write (saves free-tier writes)
export const MAX_SYNC_BYTES = 128_000 // must match the Worker's cap

// Key-order-independent JSON, so identical data from two devices compares equal.
const stable = (v) =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  : JSON.stringify(v ?? null)

const enc = new TextEncoder()
const dec = new TextDecoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/* ---------------- token ---------------- */

export function newToken() {
  return PREFIX + b64u(crypto.getRandomValues(new Uint8Array(32)))
}

export function parseToken(input) {
  const m = String(input ?? '').match(/fc1_[A-Za-z0-9_-]{43}/)
  if (!m) return null
  try {
    return unb64u(m[0].slice(PREFIX.length)).length === 32 ? m[0] : null
  } catch {
    return null
  }
}

async function deriveKeys(token) {
  const raw = unb64u(token.slice(PREFIX.length))
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('covers-sync-v1'), info: enc.encode(info) })
  const [id, write, key] = await Promise.all([
    crypto.subtle.deriveBits(params('covers/id'), master, 256),
    crypto.subtle.deriveBits(params('covers/write'), master, 256),
    crypto.subtle.deriveKey(params('covers/enc'), master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
  ])
  return { id: hex(id), write: hex(write), key }
}

/* ---------------- encryption (gzip → AES-GCM) ---------------- */

async function gzip(bytes, mode) {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const packed = await gzip(enc.encode(JSON.stringify(value)), 'c')
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed))
  const out = new Uint8Array(12 + cipher.length)
  out.set(iv)
  out.set(cipher, 12)
  let s = ''
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function open(key, data) {
  const bytes = unb64u(data)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
    return JSON.parse(dec.decode(await gzip(new Uint8Array(plain), 'd')))
  } catch {
    throw new Error('Could not decrypt synced data — the token may be wrong.')
  }
}

/* ---------------- keep images out of sync ---------------- */
// Published covers live in the user's GitHub repo, so sync only carries project data. Embedded
// uploads (data: URLs) are replaced by a marker; each device keeps its own copy, and devices
// without it fall back to the published cover image.

const LOCAL_ONLY = 'local-only:'
const isBlob = (v) => typeof v === 'string' && v.startsWith('data:')

function stripBlobs(project) {
  return {
    ...project,
    rows: project.rows.map((row) => ({
      ...row,
      items: row.items.map((item) => {
        const d = item.design
        if (!isBlob(d?.image) && !isBlob(d?.logo?.src)) return item
        return {
          ...item,
          design: {
            ...d,
            image: isBlob(d.image) ? LOCAL_ONLY + item.id : d.image,
            logo: d.logo && isBlob(d.logo.src) ? { ...d.logo, src: LOCAL_ONLY + item.id } : d.logo,
          },
        }
      }),
    })),
  }
}

// After merging, put this device's embedded images back where remote data only has the marker.
function restoreBlobs(merged, local) {
  const mine = new Map(local.rows.flatMap((r) => r.items).map((i) => [i.id, i.design]))
  return {
    ...merged,
    rows: merged.rows.map((row) => ({
      ...row,
      items: row.items.map((item) => {
        const d = item.design
        const own = mine.get(item.id)
        const markedImage = d?.image?.startsWith?.(LOCAL_ONLY)
        const markedLogo = d?.logo?.src?.startsWith?.(LOCAL_ONLY)
        if (!markedImage && !markedLogo) return item
        return {
          ...item,
          design: {
            ...d,
            // Our upload if we have it; otherwise the published cover (if any) as the background.
            image: markedImage ? (isBlob(own?.image) ? own.image : item.imageURL || '') : d.image,
            ...(markedImage && !isBlob(own?.image) && item.imageURL ? { dim: 0, text: false } : {}),
            logo: markedLogo ? (isBlob(own?.logo?.src) ? { ...d.logo, src: own.logo.src } : null) : d.logo,
          },
        }
      }),
    })),
  }
}

/* ---------------- engine ---------------- */

const loadState = () => {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) ?? null
  } catch {
    return null
  }
}
const saveState = (s) => {
  try {
    s ? localStorage.setItem(STATE_KEY, JSON.stringify(s)) : localStorage.removeItem(STATE_KEY)
  } catch {}
}

export const savedToken = () => loadState()?.token ?? null

/**
 * getLocal() → { project, settings } current state
 * applyRemote({ project, settings }) → replace local state with merged state (without re-stamping)
 * onStatus({ state: 'off'|'syncing'|'synced'|'offline'|'error', message, at })
 */
export class SyncEngine {
  constructor({ getLocal, applyRemote, onStatus }) {
    Object.assign(this, { getLocal, applyRemote, onStatus })
    this.state = loadState() // { token, version }
    this.keys = null
    this.queue = Promise.resolve()
    this.lastSent = null
    this.timer = null
    this.pushTimer = null
    this.onVisible = () => document.visibilityState === 'visible' && this.pull()
    this.onOnline = () => this.pull()
  }

  get connected() {
    return !!this.state?.token
  }

  status(state, message = '') {
    this.onStatus({ state, message, at: Date.now() })
  }

  // Serialize all network operations so pushes and pulls never interleave.
  run(fn) {
    this.queue = this.queue.then(fn, fn).catch((e) => {
      this.status(navigator.onLine ? 'error' : 'offline', e.message)
    })
    return this.queue
  }

  async start() {
    if (!this.connected) return this.status('off')
    if (!SYNC_URL) return this.status('error', 'Sync server is not configured for this build.')
    this.keys = await deriveKeys(this.state.token)
    this.lastSent = null
    window.addEventListener('focus', this.onVisible)
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('online', this.onOnline)
    clearInterval(this.timer)
    this.timer = setInterval(() => document.visibilityState === 'visible' && this.pull(), POLL_MS)
    return this.pull()
  }

  stop() {
    clearInterval(this.timer)
    clearTimeout(this.pushTimer)
    window.removeEventListener('focus', this.onVisible)
    document.removeEventListener('visibilitychange', this.onVisible)
    window.removeEventListener('online', this.onOnline)
  }

  /** Join (or create) the vault for a token. Local and remote data are merged, never overwritten. */
  async connect(token) {
    this.stop()
    this.state = { token, version: 0 }
    saveState(this.state)
    return this.start()
  }

  disconnect() {
    this.stop()
    this.state = null
    this.keys = null
    saveState(null)
    this.status('off')
  }

  async destroy() {
    await this.run(async () => {
      const res = await fetch(`${SYNC_URL}/v1/vaults/${this.keys.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.keys.write}` },
        credentials: 'omit',
      })
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`)
    })
    this.disconnect()
  }

  /** Call after every local change. */
  changed() {
    if (!this.connected || !this.keys) return
    clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => this.push(), PUSH_DEBOUNCE_MS)
  }

  payload() {
    const { project, settings } = this.getLocal()
    return { v: 1, project: stripBlobs(project), settings: { ...pickSynced(settings), syncedAt: settings.syncedAt ?? 0 } }
  }

  mergeInto(remote) {
    const local = this.getLocal()
    // A device with no covers yet (fresh browser) just adopts the synced project, instead of
    // merging in its empty placeholder row.
    const pristine = !local.project.rows.some((r) => r.items.length) && !Object.keys(local.project.deleted ?? {}).length
    const merged = pristine && remote.project?.rows?.length ? remote.project : mergeProjects(local.project, remote.project)
    const project = restoreBlobs(merged, local.project)
    const settings = mergeSettings(local.settings, remote.settings)
    const changed = JSON.stringify(project) !== JSON.stringify(local.project) || settings !== local.settings
    if (changed) this.applyRemote({ project, settings })
    return changed
  }

  pull() {
    return this.run(async () => {
      if (!this.keys) return
      this.status('syncing')
      // Conditional GET (via query, so no CORS preflight) once we know what the server holds.
      const since = this.state.version && this.lastSent !== null ? `?since=${this.state.version}` : ''
      const res = await fetch(`${SYNC_URL}/v1/vaults/${this.keys.id}${since}`, {
        credentials: 'omit',
        cache: 'no-store',
      })
      if (res.status === 304) return this.afterPull()
      if (res.status === 404) {
        this.state.version = 0
        return this.pushNow()
      }
      if (res.status === 503) throw new Error('Sync server is busy — your changes are safe here and will sync later.')
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`)
      const { version, data } = await res.json()
      const remote = await open(this.keys.key, data)
      this.mergeInto(remote)
      this.setVersion(version)
      this.lastSent = stable(remote) // what the server holds now
      return this.afterPull()
    })
  }

  // After pulling, push if this device has changes the server doesn't.
  async afterPull() {
    if (stable(this.payload()) === this.lastSent) return this.status('synced')
    return this.pushNow()
  }

  push() {
    return this.run(() => this.pushNow())
  }

  async pushNow(attempt = 0) {
    if (!this.keys) return
    const payload = this.payload()
    const body = stable(payload)
    if (body === this.lastSent) return this.status('synced')
    this.status('syncing')

    const data = await seal(this.keys.key, payload)
    if (data.length > MAX_SYNC_BYTES) {
      throw new Error(`Too much to sync (${Math.round(data.length / 1000)} KB of ${MAX_SYNC_BYTES / 1000} KB). Try removing unused rows or covers.`)
    }
    const res = await fetch(`${SYNC_URL}/v1/vaults/${this.keys.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.keys.write}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: this.state.version ?? 0, data }),
      credentials: 'omit',
    })

    if (res.status === 409 && attempt < 4) {
      // Someone else wrote first: merge their data with ours, then try again.
      const conflict = await res.json()
      if (conflict.data) {
        const remote = await open(this.keys.key, conflict.data)
        this.mergeInto(remote)
        this.setVersion(conflict.version)
        this.lastSent = stable(remote)
      } else {
        const latest = await fetch(`${SYNC_URL}/v1/vaults/${this.keys.id}`, { credentials: 'omit', cache: 'no-store' })
        if (latest.ok) {
          const l = await latest.json()
          const remote = await open(this.keys.key, l.data)
          this.mergeInto(remote)
          this.setVersion(l.version)
          this.lastSent = stable(remote)
        }
      }
      return this.pushNow(attempt + 1)
    }
    if (res.status === 503) throw new Error('Sync server is busy — your changes are safe here and will sync later.')
    if (res.status === 413) throw new Error('Too much data to sync — remove large uploaded images (use image URLs instead).')
    if (res.status === 403) throw new Error('This token was rejected by the sync server.')
    if (!res.ok) throw new Error(`Sync server responded ${res.status}`)

    const { version } = await res.json()
    this.setVersion(version)
    this.lastSent = body
    this.status('synced')
  }

  setVersion(version) {
    this.state = { ...this.state, version }
    saveState(this.state)
  }
}
