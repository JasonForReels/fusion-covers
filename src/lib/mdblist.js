// MDBList (user's own free API key, straight from the browser — api.mdblist.com sends CORS headers).
// Fusion has no native MDBList source, so each list is turned into one Fusion reads:
//   1. a native `traktList` when the MDBList list is mirrored on Trakt (same user + slug), else
//   2. an `addonCatalog` through the user's AIOMetadata addon (`movie::mdblist.<id>`), if it has the list, else
//   3. an `addonCatalog` from our Worker's keyless MDBList addon (sync-worker/src/mdblist.js).

import { IMG, cleanKey } from './tmdb.js'

const SYNC_URL = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/+$/, '')

const API = 'https://api.mdblist.com'

async function mdb(path, params, key) {
  if (!key) throw new Error('Add your MDBList API key in Settings first.')
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, v)
  url.searchParams.set('apikey', key.trim())
  let res
  try {
    res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
  } catch {
    throw new Error('Could not reach MDBList.')
  }
  if (res.status === 401 || res.status === 403) throw new Error('MDBList rejected the API key.')
  if (res.status === 429) throw new Error('MDBList daily API limit reached (free keys allow 1,000 requests/day).')
  if (!res.ok) throw new Error(`MDBList responded ${res.status}`)
  return res.json()
}

const toList = (l, owner) => ({
  key: `mdblist:${l.id}`,
  id: l.id,
  name: l.name,
  slug: l.slug,
  owner: l.user_name ?? owner ?? '',
  mediatype: l.mediatype ?? '',
  count: l.items,
  likes: l.likes,
})

export async function myLists(key) {
  return (await mdb('/lists/user', {}, key)).map((l) => toList(l))
}

export async function userLists(username, key) {
  return (await mdb(`/lists/user/${encodeURIComponent(username)}`, {}, key)).map((l) => toList(l, username))
}

export async function searchLists(query, key) {
  return (await mdb('/lists/search', { query, limit: 40 }, key)).map((l) => toList(l))
}

export async function topLists(key) {
  return (await mdb('/lists/top', { limit: 100 }, key)).map((l) => toList(l))
}

// MDBList has no category endpoint, so categories are keyword searches merged together.
export const CATEGORIES = {
  streaming: ['Netflix', 'Disney+', 'Prime Video', 'Max', 'Hulu', 'Apple TV+', 'Paramount+', 'Peacock', 'Crunchyroll'],
  studios: ['Marvel', 'Pixar', 'DreamWorks', 'Warner Bros', 'A24', 'Lucasfilm', 'Studio Ghibli', 'Blumhouse', 'Universal'],
}

/** Searches several terms (one API call each), de-duplicated by list id. */
export async function searchMany(terms, key) {
  const results = await Promise.all(terms.map((t) => searchLists(t, key).catch(() => [])))
  const seen = new Map()
  for (const l of results.flat()) if (!seen.has(l.id)) seen.set(l.id, l)
  return [...seen.values()]
}

export const SORTS = {
  popular: (a, b) => (b.likes ?? 0) - (a.likes ?? 0) || (b.count ?? 0) - (a.count ?? 0),
  items: (a, b) => (b.count ?? 0) - (a.count ?? 0),
  name: (a, b) => a.name.localeCompare(b.name),
}

// Accepts "username", "mdblist.com/lists/user/slug", or a numeric list id.
export async function loadMdblistQuery(input, key) {
  const q = input.trim()
  const m = q.match(/mdblist\.com\/lists\/([^/?#]+)\/([^/?#]+)/i)
  if (m) return [toList(await mdb(`/lists/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`, {}, key), m[1])]
  if (/^\d+$/.test(q)) return [toList(await mdb(`/lists/${q}`, {}, key))]
  try {
    const lists = await userLists(q.replace(/^@/, ''), key)
    if (lists.length) return lists
  } catch {
    // Not a username — fall back to search.
  }
  return searchLists(q, key)
}

/* ---------------- turning a list into Fusion data sources ---------------- */

const catalogTypes = (mediatype) => {
  const m = String(mediatype).toLowerCase()
  if (m === 'movie') return ['movie']
  if (m === 'show' || m === 'series') return ['series']
  return ['movie', 'series'] // mixed lists: one catalog per type
}

async function traktMirror(list, traktClientId) {
  if (!traktClientId || !list.owner || !list.slug) return null
  try {
    const res = await fetch(
      `https://api.trakt.tv/users/${encodeURIComponent(list.owner)}/lists/${encodeURIComponent(list.slug)}`,
      { credentials: 'omit', headers: { 'trakt-api-key': traktClientId, 'trakt-api-version': '2' } },
    )
    if (!res.ok) return null
    const t = await res.json()
    if (t.privacy && t.privacy !== 'public') return null
    return {
      kind: 'traktList',
      payload: { listName: t.name, listSlug: t.ids.slug, traktId: t.ids.trakt, username: t.user?.ids?.slug ?? list.owner },
    }
  } catch {
    return null
  }
}

/**
 * Returns { sources, via: 'trakt' | 'aiometadata', missingInAddon: boolean } or throws with guidance.
 * aiometadata: { url, catalogIds:Set } from a loaded AIOMetadata manifest (optional).
 */
export async function sourcesForList(list, { traktClientId, aiometadata }) {
  const trakt = await traktMirror(list, traktClientId)
  if (trakt) return { sources: [trakt], via: 'trakt', missingInAddon: false }

  if (aiometadata?.url) {
    const sources = catalogTypes(list.mediatype).map((type) => ({
      kind: 'addonCatalog',
      payload: { addonId: aiometadata.url, catalogId: `${type}::mdblist.${list.id}`, type, catalogType: type },
    }))
    const missingInAddon = sources.some((s) => !aiometadata.catalogIds?.has(s.payload.catalogId))
    if (!missingInAddon) return { sources, via: 'aiometadata', missingInAddon }
  }

  // No setup needed: our Worker serves the public list as a Stremio addon.
  if (SYNC_URL && list.owner && list.slug) {
    const types = catalogTypes(list.mediatype)
    const q = new URLSearchParams({ name: list.name, types: types.join(',') })
    const addonId = `${SYNC_URL}/mdblist/${encodeURIComponent(list.owner)}/${encodeURIComponent(list.slug)}/manifest.json?${q}`
    const sources = types.map((type) => ({
      kind: 'addonCatalog',
      payload: { addonId, catalogId: `${type}::list`, type, catalogType: type },
    }))
    return { sources, via: 'mdblist', missingInAddon: false }
  }

  throw new Error(`Couldn't turn “${list.name}” into a Fusion source (list has no owner/slug).`)
}

/** AIOMetadata "catalogs only" import file for lists that aren't in the user's addon yet. */
export function aiometadataImportFile(entries) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogs: entries.map(({ list, type }) => ({
      id: `mdblist.${list.id}`,
      type,
      name: list.name,
      enabled: true,
      source: 'mdblist',
      displayType: type,
    })),
  }
}

/* ---------------- posters that actually come from the list ---------------- */

export async function mdblistPosters(listId, { mdblistKey, tmdbKey: rawTmdb }, limit = 16) {
  const tmdbKey = cleanKey(rawTmdb)
  if (!tmdbKey) return []
  const data = await mdb(`/lists/${listId}/items`, { limit: 30 }, mdblistKey)
  const entries = [...(data.movies ?? []), ...(data.shows ?? [])]
    .map((i) => ({ tmdb: i.ids?.tmdb ?? i.tmdb_id, type: i.mediatype === 'show' ? 'tv' : 'movie' }))
    .filter((i) => i.tmdb)
    .slice(0, limit)
  const auth = tmdbKey.startsWith('eyJ')
  const posters = await Promise.all(
    entries.map(async ({ tmdb, type }) => {
      const url = new URL(`https://api.themoviedb.org/3/${type}/${tmdb}`)
      if (!auth) url.searchParams.set('api_key', tmdbKey)
      const res = await fetch(url, { credentials: 'omit', headers: auth ? { Authorization: `Bearer ${tmdbKey}` } : {} })
      return res.ok ? IMG((await res.json()).poster_path) : ''
    }),
  )
  return posters.filter(Boolean)
}
