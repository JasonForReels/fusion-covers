// "Host with Covers": stores a published config.json and its cover images so users don't need GitHub.
// Public reads (Fusion fetches these); writes need the host's random secret (only its hash is stored).
//
// Free-plan budget: covers are uploaded as JPEG (~40–120 KB), unchanged files are never re-uploaded,
// each host is capped at MAX_HOST_BYTES, and hosts Fusion hasn't read for INACTIVE_DAYS are purged.

const ID_RE = /^[a-f0-9]{32}$/
const SECRET_RE = /^[a-f0-9]{64}$/
const NAME_RE = /^covers\/[A-Za-z0-9._-]{1,80}\.(jpg|png|webp)$/
const MAX_FILE = 900_000
const MAX_FILES = 300
export const MAX_HOST_BYTES = 12_000_000
const DAY_MS = 24 * 3600 * 1000
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const reply = (body, status, headers) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...headers },
  })

/**
 * GET    /h/<id>/config.json | /h/<id>/covers/<file>   public
 * GET    /h/<id>                                        (auth) { files: { name: hash } }
 * PUT    /h/<id>/covers/<file>                          (auth, creates host on first write) raw image body
 * PUT    /h/<id>                                        (auth) { config, keep: [names] } → writes config, prunes the rest
 * DELETE /h/<id>                                        (auth) removes everything
 */
export async function hostRequest(req, url, DB, h) {
  const m = url.pathname.match(/^\/h\/([^/]+)(?:\/(.+))?$/)
  const id = m?.[1]
  const name = m?.[2] ? decodeURIComponent(m[2]) : ''
  if (!id || !ID_RE.test(id)) return reply({ error: 'bad_id' }, 400, h)

  if (req.method === 'GET' && name) {
    const pub = { 'Access-Control-Allow-Origin': '*' }
    const row = await DB.prepare('SELECT type, hash, data FROM host_files WHERE host_id = ? AND name = ?').bind(id, name).first()
    if (!row) return reply({ error: 'not_found' }, 404, pub)
    if (name === 'config.json') {
      // Fusion reading the config keeps the host alive (at most one write per day).
      await DB.prepare('UPDATE hosts SET accessed_at = ? WHERE id = ? AND accessed_at < ?').bind(Date.now(), id, Date.now() - DAY_MS).run().catch(() => {})
    }
    const etag = `"${row.hash.slice(0, 32)}"`
    const cache = name === 'config.json' ? 'public, max-age=60' : 'public, max-age=86400'
    if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ...pub, ETag: etag, 'Cache-Control': cache } })
    return new Response(new Uint8Array(row.data), { headers: { ...pub, 'Content-Type': row.type, ETag: etag, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } })
  }

  const host = await DB.prepare('SELECT write_hash, bytes FROM hosts WHERE id = ?').bind(id).first()
  const secret = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!SECRET_RE.test(secret)) return reply({ error: 'forbidden' }, 403, h)
  const secretHash = await sha256Hex(secret)
  if (host && !safeEqual(secretHash, host.write_hash)) return reply({ error: 'forbidden' }, 403, h)

  if (req.method === 'GET' && !name) {
    if (!host) return reply({ files: {} }, 200, h)
    const { results } = await DB.prepare('SELECT name, hash FROM host_files WHERE host_id = ?').bind(id).all()
    return reply({ files: Object.fromEntries(results.map((r) => [r.name, r.hash])) }, 200, h)
  }

  if (req.method === 'PUT' && name) {
    if (!NAME_RE.test(name)) return reply({ error: 'bad_name' }, 400, h)
    const data = await req.arrayBuffer()
    if (data.byteLength > MAX_FILE) return reply({ error: 'file_too_large', max: MAX_FILE }, 413, h)
    const now = Date.now()
    if (!host) {
      await DB.prepare('INSERT INTO hosts (id, write_hash, bytes, updated_at, accessed_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, secretHash, now, now).run()
      const created = await DB.prepare('SELECT write_hash FROM hosts WHERE id = ?').bind(id).first()
      if (!safeEqual(created.write_hash, secretHash)) return reply({ error: 'forbidden' }, 403, h)
    }
    const old = await DB.prepare('SELECT size FROM host_files WHERE host_id = ? AND name = ?').bind(id, name).first()
    const count = await DB.prepare('SELECT COUNT(*) AS n FROM host_files WHERE host_id = ?').bind(id).first('n')
    if (!old && count >= MAX_FILES) return reply({ error: 'too_many_files', max: MAX_FILES }, 413, h)
    const bytes = (host?.bytes ?? 0) - (old?.size ?? 0) + data.byteLength
    if (bytes > MAX_HOST_BYTES) return reply({ error: 'host_full', max: MAX_HOST_BYTES }, 413, h)
    await DB.batch([
      DB.prepare('INSERT INTO host_files (host_id, name, type, hash, size, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(host_id, name) DO UPDATE SET type = excluded.type, hash = excluded.hash, size = excluded.size, data = excluded.data')
        .bind(id, name, TYPES[name.split('.').pop()], await sha256Hex(data), data.byteLength, data),
      DB.prepare('UPDATE hosts SET bytes = ?, updated_at = ? WHERE id = ?').bind(bytes, now, id),
    ])
    return reply({ ok: true }, 200, h)
  }

  if (req.method === 'PUT' && !name) {
    const text = await req.text()
    if (text.length > 400_000) return reply({ error: 'too_large' }, 413, h)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return reply({ error: 'bad_json' }, 400, h)
    }
    if (body?.config?.exportType !== 'fusionWidgets' || !Array.isArray(body.keep)) return reply({ error: 'bad_body' }, 400, h)
    const now = Date.now()
    if (!host) {
      await DB.prepare('INSERT INTO hosts (id, write_hash, bytes, updated_at, accessed_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, secretHash, now, now).run()
    }
    const config = JSON.stringify(body.config, null, 2)
    const keep = new Set(body.keep.filter((n) => typeof n === 'string'))
    const { results } = await DB.prepare('SELECT name FROM host_files WHERE host_id = ?').bind(id).all()
    const stale = results.map((r) => r.name).filter((n) => n !== 'config.json' && !keep.has(n))
    await DB.batch([
      ...stale.map((n) => DB.prepare('DELETE FROM host_files WHERE host_id = ? AND name = ?').bind(id, n)),
      DB.prepare('INSERT INTO host_files (host_id, name, type, hash, size, data) VALUES (?, \'config.json\', \'application/json\', ?, ?, ?) ON CONFLICT(host_id, name) DO UPDATE SET hash = excluded.hash, size = excluded.size, data = excluded.data')
        .bind(id, await sha256Hex(config), config.length, new TextEncoder().encode(config)),
      DB.prepare('UPDATE hosts SET bytes = (SELECT COALESCE(SUM(size), 0) FROM host_files WHERE host_id = ?), updated_at = ?, accessed_at = ? WHERE id = ?').bind(id, now, now, id),
    ])
    return reply({ ok: true, url: `${url.origin}/h/${id}/config.json` }, 200, h)
  }

  if (req.method === 'DELETE' && !name) {
    if (host) await DB.batch([DB.prepare('DELETE FROM host_files WHERE host_id = ?').bind(id), DB.prepare('DELETE FROM hosts WHERE id = ?').bind(id)])
    return reply(null, 204, h)
  }

  return reply({ error: 'method_not_allowed' }, 405, h)
}

export async function purgeHosts(db, cutoff) {
  const { results } = await db.prepare('SELECT id FROM hosts WHERE accessed_at < ? LIMIT 500').bind(cutoff).all()
  for (const { id } of results) {
    await db.batch([db.prepare('DELETE FROM host_files WHERE host_id = ?').bind(id), db.prepare('DELETE FROM hosts WHERE id = ?').bind(id)])
  }
}
