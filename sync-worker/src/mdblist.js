// Keyless Stremio catalog addon for any public MDBList list, so Fusion can read MDBList without
// AIOMetadata. Uses mdblist.com's public list JSON (no API key), cached at the edge.
//   /mdblist/<owner>/<slug>/manifest.json
//   /mdblist/<owner>/<slug>/catalog/<movie|series>/list[/skip=N].json

const PAGE = 100
const SEG = /^[A-Za-z0-9_.~%-]{1,200}$/
const TTL = 3600

const open = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: open })

async function listPage(owner, slug, offset, limit, ctx) {
  const src = `https://mdblist.com/lists/${owner}/${slug}/json?limit=${limit}&offset=${offset}`
  const cache = caches.default
  const hit = await cache.match(src)
  if (hit) return hit.json()
  const res = await fetch(src, { headers: { 'User-Agent': 'fusion-covers' } })
  if (!res.ok) throw new Error(String(res.status))
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('not_a_list')
  ctx?.waitUntil(cache.put(src, new Response(JSON.stringify(data), { headers: { 'Cache-Control': `public, max-age=${TTL}` } })))
  return data
}

export async function mdblistAddon(url, ctx) {
  const m = url.pathname.match(/^\/mdblist\/([^/]+)\/([^/]+)\/(manifest\.json|catalog\/(movie|series)\/list(?:\/skip=(\d+))?\.json)$/)
  if (!m || !SEG.test(m[1]) || !SEG.test(m[2])) return out({ error: 'not_found' }, 404)
  const [, owner, slug, , type, skip] = m
  const name = decodeURIComponent(url.searchParams.get('name') || slug.replace(/-/g, ' '))

  try {
    if (!type) {
      const types = (url.searchParams.get('types') || 'movie,series').split(',').filter((t) => t === 'movie' || t === 'series')
      return out({
        id: `com.fusioncovers.mdblist.${owner}.${slug}`.toLowerCase(),
        version: '1.0.0',
        name: `MDBList · ${name}`,
        description: `@${decodeURIComponent(owner)} on MDBList`,
        resources: ['catalog'],
        types,
        idPrefixes: ['tt'],
        catalogs: types.map((t) => ({ type: t, id: 'list', name, extra: [{ name: 'skip' }] })),
      })
    }
    // Mixed lists: page through the list, keeping only the requested type.
    const want = type === 'series' ? 'show' : 'movie'
    const start = Number(skip ?? 0)
    const metas = []
    for (let offset = 0, matched = 0; metas.length < PAGE && offset < 5000; offset += PAGE) {
      const items = await listPage(owner, slug, offset, PAGE, ctx)
      for (const i of items) {
        if (i.mediatype !== want || !i.imdb_id) continue
        if (matched++ < start) continue
        if (metas.length < PAGE) {
          metas.push({ id: i.imdb_id, type, name: i.title, releaseInfo: i.release_year ? String(i.release_year) : undefined,
            poster: `https://images.metahub.space/poster/medium/${i.imdb_id}/img` })
        }
      }
      if (items.length < PAGE) break
    }
    return out({ metas })
  } catch {
    return out({ metas: [] }, 502)
  }
}
