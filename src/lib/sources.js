// Every request here goes straight from the browser to the source. No middleman proxy.

async function getJson(url, init) {
  let res
  try {
    res = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit', ...init })
  } catch {
    throw new Error(`Could not reach ${new URL(url).host} (offline, or it blocks browser requests).`)
  }
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status} ${res.statusText}`.trim())
  return res.json()
}

/* ---------------- Stremio addons ---------------- */

export function normalizeManifestUrl(input) {
  let url = input.trim().replace(/^stremio:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!/manifest\.json(\?.*)?$/i.test(url)) url = url.replace(/\/+$/, '') + '/manifest.json'
  return url
}

const addonBase = (manifestUrl) => manifestUrl.replace(/\/manifest\.json(\?.*)?$/i, '')

export async function loadManifest(input) {
  const manifestUrl = normalizeManifestUrl(input)
  const manifest = await getJson(manifestUrl)
  const catalogs = (manifest.catalogs ?? []).map((c) => ({
    key: `${c.type}::${c.id}`,
    name: c.name || c.id,
    type: c.type,
    requiresExtra: (c.extra ?? []).some((e) => e.isRequired) || (c.extraRequired ?? []).length > 0,
    dataSource: {
      kind: 'addonCatalog',
      payload: { addonId: manifestUrl, catalogId: `${c.type}::${c.id}`, type: c.type },
    },
  }))
  return { manifestUrl, name: manifest.name ?? manifest.id ?? 'Addon', catalogs }
}

export async function addonPosters(manifestUrl, type, catalogId, limit = 12) {
  const id = catalogId.split('::').slice(1).join('::')
  const data = await getJson(`${addonBase(manifestUrl)}/catalog/${type}/${encodeURIComponent(id)}.json`)
  return (data.metas ?? []).map((m) => m.poster).filter(Boolean).slice(0, limit)
}

/* ---------------- Trakt (public API, user's own Client ID) ---------------- */

const TRAKT = 'https://api.trakt.tv'

function trakt(path, clientId) {
  if (!clientId) throw new Error('Add your Trakt Client ID in Settings first.')
  return getJson(`${TRAKT}${path}`, {
    headers: { 'trakt-api-key': clientId, 'trakt-api-version': '2', 'content-type': 'application/json' },
  })
}

const toList = (l, username) => ({
  key: `trakt:${l.ids.trakt}`,
  name: l.name,
  owner: username ?? l.user?.ids?.slug ?? l.user?.username,
  count: l.item_count,
  likes: l.likes,
  dataSource: {
    kind: 'traktList',
    payload: {
      listName: l.name,
      listSlug: l.ids.slug,
      traktId: l.ids.trakt,
      username: username ?? l.user?.ids?.slug ?? l.user?.username,
    },
  },
})

export function parseTraktQuery(input) {
  const m = input.trim().match(/trakt\.tv\/users\/([^/]+)\/lists\/([^/?#]+)/i)
  if (m) return { username: decodeURIComponent(m[1]), slug: decodeURIComponent(m[2]) }
  return { username: input.trim().replace(/^@/, ''), slug: null }
}

export async function loadTraktLists(input, clientId) {
  const { username, slug } = parseTraktQuery(input)
  if (!username) throw new Error('Enter a Trakt username or list URL.')
  const u = encodeURIComponent(username)
  if (slug) return [toList(await trakt(`/users/${u}/lists/${encodeURIComponent(slug)}`, clientId), username)]
  return (await trakt(`/users/${u}/lists`, clientId)).map((l) => toList(l, username))
}

export async function loadTraktPopular(clientId) {
  return (await trakt('/lists/popular?limit=40', clientId)).map((e) => toList(e.list))
}

export async function traktPosters({ username, listSlug }, clientId, limit = 12) {
  const items = await trakt(
    `/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(listSlug)}/items?extended=images&limit=${limit}`,
    clientId,
  )
  return items
    .map((i) => i[i.type]?.images?.poster?.[0])
    .filter(Boolean)
    .map((src) => (src.startsWith('http') ? src : `https://${src}`))
}
