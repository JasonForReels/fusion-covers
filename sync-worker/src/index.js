import { mdblistAddon } from './mdblist.js'
import { hostRequest, purgeHosts } from './hosting.js'

// Zero-knowledge sync store for Covers. The browser encrypts everything with a key derived from
// the user's sync token; this Worker only ever sees an opaque id, a hash of a write secret, and
// ciphertext. No accounts, no logging, no analytics.

// Budget notes (Cloudflare free plan: D1 500 MB per database, 10 databases, 100k row writes/day):
// - Vaults are small: a typical project is 1–10 KB after gzip+encryption; images are never
//   synced (covers live in the user's GitHub repo). The hard cap below keeps any single vault from eating the budget.
// - Vaults nobody has opened in INACTIVE_DAYS are deleted by the daily cron.
// - Vaults can be spread over up to 10 free databases (see SHARD_MAP / README), no code changes.
const MAX_BYTES = 128_000 // ciphertext cap per vault; images are never synced, so real vaults are a few KB
const ID_RE = /^[a-f0-9]{64}$/
const SECRET_RE = /^[a-f0-9]{64}$/
const DAY_MS = 24 * 3600 * 1000
const INACTIVE_DAYS = 180

// SHARD_MAP is 16 characters, one per leading hex digit of the vault id; each character is the
// index of the D1 binding holding those vaults ("0" → DB, "1" → DB_1, …). Default: all in DB.
function dbFor(env, id) {
  const map = (env.SHARD_MAP || '0'.repeat(16)).padEnd(16, '0')
  const n = map[parseInt(id[0], 16)]
  const db = n === '0' ? env.DB : env[`DB_${n}`]
  if (!db) throw new Error(`Missing D1 binding for shard ${n}`)
  return db
}

function allDbs(env) {
  return [env.DB, ...Array.from({ length: 9 }, (_, i) => env[`DB_${i + 1}`])].filter(Boolean)
}

function cors(req, env) {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers },
  })

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time compare of two equal-length hex strings.
function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function authorize(req, row) {
  const secret = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!SECRET_RE.test(secret)) return false
  return safeEqual(await sha256Hex(secret), row.write_hash)
}

/* ---------------- GitHub sign-in (OAuth web flow) ----------------
 * The only thing the Worker adds is the client secret for the code → token exchange, which GitHub
 * doesn't allow from browsers. Tokens are handed to the app in the URL fragment (never sent to any
 * server, and removed from the address bar immediately) and are not stored here.
 */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
}

function allowedReturn(env, value) {
  try {
    const u = new URL(value)
    return env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(u.origin) ? u : null
  } catch {
    return null
  }
}

async function githubAuth(req, env, url) {
  if (url.pathname === '/auth/github/status') {
    const enabled = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.STATE_SECRET)
    return json({ enabled }, 200, { ...cors(req, env), 'Cache-Control': 'public, max-age=300' })
  }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.STATE_SECRET) {
    return new Response('GitHub sign-in is not configured on this server.', { status: 503 })
  }
  const callback = `${url.origin}/auth/github/callback`

  if (url.pathname === '/auth/github/start') {
    const ret = allowedReturn(env, url.searchParams.get('return') ?? '')
    const nonce = url.searchParams.get('nonce') ?? ''
    if (!ret || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return new Response('Bad sign-in request.', { status: 400 })
    const body = b64url(new TextEncoder().encode(JSON.stringify({ r: ret.href, n: nonce, t: Date.now() })))
    const state = `${body}.${await hmac(env.STATE_SECRET, body)}`
    const gh = new URL('https://github.com/login/oauth/authorize')
    gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
    gh.searchParams.set('redirect_uri', callback)
    gh.searchParams.set('scope', 'public_repo')
    gh.searchParams.set('state', state)
    return Response.redirect(gh.href, 302)
  }

  if (url.pathname === '/auth/github/callback') {
    const [body, sig] = (url.searchParams.get('state') ?? '').split('.')
    if (!body || !sig || sig !== (await hmac(env.STATE_SECRET, body))) return new Response('Invalid sign-in state.', { status: 400 })
    const state = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    const ret = allowedReturn(env, state.r)
    if (!ret || Date.now() - state.t > 10 * 60 * 1000) return new Response('Sign-in expired, please try again.', { status: 400 })

    const back = (params) => {
      const target = new URL(ret.href)
      target.hash = new URLSearchParams({ ...params, gh_nonce: state.n }).toString()
      return new Response(null, { status: 302, headers: { Location: target.href, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } })
    }

    const code = url.searchParams.get('code')
    if (!code) return back({ gh_error: url.searchParams.get('error_description') ?? 'Sign-in was cancelled.' })
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'fusion-covers-sync' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.access_token) return back({ gh_error: data.error_description ?? 'GitHub did not return a token.' })
    return back({ gh_token: data.access_token })
  }

  return new Response('Not found', { status: 404 })
}

async function handle(req, env, ctx) {
  if (new URL(req.url).pathname.startsWith('/mdblist/')) return mdblistAddon(new URL(req.url), ctx)
  if (new URL(req.url).pathname.startsWith('/auth/github/')) return githubAuth(req, env, new URL(req.url))
  const h = cors(req, env)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })

  const url = new URL(req.url)
  if (url.pathname.startsWith('/h/')) {
    const hostId = url.pathname.split('/')[2] ?? ''
    if (!/^[a-f0-9]{32}$/.test(hostId)) return json({ error: 'bad_id' }, 400, h)
    try {
      return await hostRequest(req, url, dbFor(env, hostId), h)
    } catch {
      return json({ error: 'unavailable' }, 503, { ...h, 'Retry-After': '3600' })
    }
  }
  const m = url.pathname.match(/^\/v1\/vaults\/([^/]+)$/)
  if (!m) return json({ error: 'not_found' }, 404, h)
  const id = m[1]
  if (!ID_RE.test(id)) return json({ error: 'bad_id' }, 400, h)

  const DB = dbFor(env, id)
  let row
  try {
    row = await DB.prepare('SELECT write_hash, version, data, updated_at, accessed_at FROM vaults WHERE id = ?').bind(id).first()
  } catch {
    // Most likely a free-tier daily limit. Clients keep their local data and retry later.
    return json({ error: 'unavailable' }, 503, { ...h, 'Retry-After': '3600' })
  }

  if (req.method === 'GET') {
    if (!row) return json({ error: 'not_found' }, 404, h)
    // Keep actively-read vaults alive; at most one write per vault per day.
    if (Date.now() - row.accessed_at > DAY_MS) {
      await DB.prepare('UPDATE vaults SET accessed_at = ? WHERE id = ?').bind(Date.now(), id).run().catch(() => {})
    }
    const etag = `"${row.version}"`
    // ?since=<version> avoids a CORS preflight per poll (custom headers would double request usage).
    if (req.headers.get('If-None-Match') === etag || url.searchParams.get('since') === String(row.version)) return new Response(null, { status: 304, headers: { ...h, ETag: etag } })
    return json({ version: row.version, data: row.data }, 200, { ...h, ETag: etag })
  }

  if (req.method === 'PUT') {
    const text = await req.text()
    if (text.length > MAX_BYTES) return json({ error: 'too_large', max: MAX_BYTES }, 413, h)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'bad_json' }, 400, h)
    }
    if (typeof body.data !== 'string' || !Number.isInteger(body.baseVersion)) return json({ error: 'bad_body' }, 400, h)
    const now = Date.now()

    if (!row) {
      const secret = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      if (!SECRET_RE.test(secret) || body.baseVersion !== 0) return json({ error: 'bad_request' }, 400, h)
      const res = await DB.prepare('INSERT INTO vaults (id, write_hash, version, data, updated_at, accessed_at) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(id, await sha256Hex(secret), body.data, now, now).run()
      if (res.meta.changes === 0) return json({ error: 'conflict' }, 409, h) // lost a creation race; client re-pulls
      return json({ version: 1 }, 201, { ...h, ETag: '"1"' })
    }

    if (!(await authorize(req, row))) return json({ error: 'forbidden' }, 403, h)
    if (body.baseVersion !== row.version) {
      return json({ error: 'conflict', version: row.version, data: row.data }, 409, h)
    }
    // Optimistic concurrency: only succeeds if nobody wrote in between.
    const res = await DB.prepare('UPDATE vaults SET data = ?, version = version + 1, updated_at = ?, accessed_at = ? WHERE id = ? AND version = ?')
      .bind(body.data, now, now, id, row.version).run()
    if (res.meta.changes === 0) {
      const latest = await DB.prepare('SELECT version, data FROM vaults WHERE id = ?').bind(id).first()
      return json({ error: 'conflict', version: latest.version, data: latest.data }, 409, h)
    }
    return json({ version: row.version + 1 }, 200, { ...h, ETag: `"${row.version + 1}"` })
  }

  if (req.method === 'DELETE') {
    if (!row) return new Response(null, { status: 204, headers: h })
    if (!(await authorize(req, row))) return json({ error: 'forbidden' }, 403, h)
    await DB.prepare('DELETE FROM vaults WHERE id = ?').bind(id).run()
    return new Response(null, { status: 204, headers: h })
  }

  return json({ error: 'method_not_allowed' }, 405, h)
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx)
    } catch {
      return json({ error: 'unavailable' }, 503, { ...cors(req, env), 'Retry-After': '3600' })
    }
  },

  async scheduled(_event, env) {
    const cutoff = Date.now() - INACTIVE_DAYS * DAY_MS
    for (const db of allDbs(env)) {
      await db.prepare('DELETE FROM vaults WHERE accessed_at < ?').bind(cutoff).run()
      await purgeHosts(db, cutoff)
    }
  },
}
