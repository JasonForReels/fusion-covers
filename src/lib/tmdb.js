// TMDB lookups for brand-accurate posters: titles on a streaming service, aired by a TV network,
// or produced by a studio. Uses the user's own TMDB key, straight from the browser.
// image.tmdb.org sends CORS headers, so these posters render without any proxy.

const API = 'https://api.themoviedb.org/3'
export const IMG = (path, size = 'w342') => (path ? `https://image.tmdb.org/t/p/${size}${path}` : '')

// Accepts a v3 API key (32 hex chars) or a v4 read access token (JWT), tolerating pasted junk
// like whitespace, quotes, "Bearer ", "api_key=" or surrounding text.
export function cleanKey(raw) {
  const text = String(raw ?? '')
  const jwt = text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)
  if (jwt) return jwt[0]
  const v3 = text.match(/\b[a-f0-9]{32}\b/i) ?? text.match(/[a-f0-9]{32}/i)
  if (v3) return v3[0].toLowerCase()
  return text.replace(/\s+/g, '')
}

export async function testKey(raw) {
  const key = cleanKey(raw)
  await tmdb('/configuration', {}, key)
  return key
}

async function tmdb(path, params, rawKey) {
  const key = cleanKey(rawKey)
  if (!key) throw new Error('Add your TMDB API key in Settings to load brand posters.')
  const url = new URL(API + path)
  const bearer = key.startsWith('eyJ') // v4 read access token
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, v)
  if (!bearer) url.searchParams.set('api_key', key)
  let res
  try {
    res = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: bearer ? { Authorization: `Bearer ${key}` } : {},
    })
  } catch {
    throw new Error('Could not reach TMDB.')
  }
  if (res.status === 401) throw new Error('TMDB rejected the API key.')
  if (!res.ok) throw new Error(`TMDB responded ${res.status}`)
  return res.json()
}

const providerCache = new Map()

// Rent/buy storefronts and add-on channels sold through another service. Picking these for a
// "what's on this service" collage is almost always a mistake (e.g. "Amazon Video" is the store,
// "Amazon Prime Video" is the subscription), so the picker hides them unless asked.
const STORE_IDS = new Set([2, 3, 7, 10, 68, 192, 105, 279, 358, 486])
const CHANNEL_RE = /(amazon|apple tv|roku premium|youtube)\s*channels?\b|\bstore\b|google play|fandango|microsoft|\bvudu\b|redbox|spectrum on demand|directv|dish|verizon|xfinity/i
function isStoreOrChannel(name, id) {
  return STORE_IDS.has(id) || CHANNEL_RE.test(name)
}

export async function listProviders(region, key) {
  const cacheKey = `${region}|${key}`
  if (!providerCache.has(cacheKey)) {
    const load = Promise.all(
      ['movie', 'tv'].map((t) => tmdb(`/watch/providers/${t}`, { watch_region: region }, key)),
    ).then(([m, t]) => {
      const byId = new Map()
      for (const p of [...m.results, ...t.results]) if (!byId.has(p.provider_id)) byId.set(p.provider_id, p)
      return [...byId.values()]
        .sort((a, b) => (a.display_priorities?.[region] ?? a.display_priority) - (b.display_priorities?.[region] ?? b.display_priority))
        .map((p) => ({ kind: 'provider', id: p.provider_id, name: p.provider_name.trim(), logo: p.logo_path, extra: isStoreOrChannel(p.provider_name, p.provider_id) }))
    })
    load.catch(() => providerCache.delete(cacheKey))
    providerCache.set(cacheKey, load)
  }
  return providerCache.get(cacheKey)
}

export async function searchCompanies(query, key) {
  const data = await tmdb('/search/company', { query }, key)
  return data.results.map((c) => ({ kind: 'company', id: c.id, name: c.name, logo: c.logo_path, country: c.origin_country }))
}

export async function brandDetails(brand, key) {
  if (brand.kind === 'provider') return brand
  const d = await tmdb(`/${brand.kind}/${brand.id}`, {}, key)
  return { ...brand, name: d.name ?? brand.name, logo: d.logo_path ?? brand.logo }
}

const norm = (s) => s.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '')

// Match a built-in logo's brand hint to a live TMDB provider for the chosen region.
export async function resolveBrandHint(hint, region, key) {
  if (hint.provider) {
    const names = [hint.provider].flat().map(norm)
    const providers = (await listProviders(region, key)).filter((x) => !x.extra)
    const p =
      providers.find((x) => names.includes(norm(x.name))) ??
      providers.find((x) => names.some((n) => norm(x.name).startsWith(n)))
    if (p) return { ...p, network: hint.network }
  }
  if (hint.network) return { kind: 'network', id: hint.network, name: hint.name }
  return null
}

function interleave(...lists) {
  const out = []
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i])
  return out
}

const SUBSCRIPTION = ['flatrate', 'free', 'ads']

// True when TMDB/JustWatch lists the title as included (not rent/buy) on the provider in region.
async function streamsOn(type, id, providerId, region, key) {
  const data = await tmdb(`/${type}/${id}/watch/providers`, {}, key)
  const r = data.results?.[region]
  return SUBSCRIPTION.some((k) => r?.[k]?.some((p) => p.provider_id === providerId))
}

export async function brandPosters(brand, region, key, limit = 16) {
  const base = { sort_by: 'popularity.desc', include_adult: 'false' }
  const discover = (type, params, page = 1) =>
    tmdb(`/discover/${type}`, { ...base, ...params, page }, key).then((d) => d.results.map((r) => ({ ...r, type })))

  const seen = new Set()
  const posters = []
  const take = (r) => {
    if (!r.poster_path || seen.has(r.poster_path) || posters.length >= limit) return
    seen.add(r.poster_path)
    posters.push(IMG(r.poster_path))
  }

  if (brand.kind === 'network') {
    ;(await discover('tv', { with_networks: brand.id, 'vote_count.gte': 5 })).forEach(take)
  } else if (brand.kind === 'company') {
    const [m, t] = await Promise.all([
      discover('movie', { with_companies: brand.id, 'vote_count.gte': 5 }),
      discover('tv', { with_companies: brand.id, 'vote_count.gte': 5 }),
    ])
    interleave(m, t).forEach(take)
  } else {
    // Originals (shows made for the service) are reliable and go first.
    if (brand.network) (await discover('tv', { with_networks: brand.network, 'vote_count.gte': 20 })).forEach(take)

    // Discover's provider filter also matches rent/buy listings, so each candidate is checked
    // against its actual watch providers before its poster is used.
    const watch = { with_watch_providers: brand.id, watch_region: region, with_watch_monetization_types: SUBSCRIPTION.join('|'), 'vote_count.gte': 10 }
    for (let page = 1; page <= 3 && posters.length < limit; page++) {
      const [tv, movie] = await Promise.all([discover('tv', watch, page), discover('movie', watch, page)])
      const candidates = interleave(tv, movie).filter((r) => r.poster_path && !seen.has(r.poster_path))
      if (!candidates.length) break
      const checks = await Promise.all(
        candidates.map((r) => streamsOn(r.type, r.id, brand.id, region, key).catch(() => false)),
      )
      candidates.filter((_, i) => checks[i]).forEach(take)
    }
  }

  if (!posters.length) {
    throw new Error(
      brand.kind === 'provider'
        ? `Nothing is streaming on ${brand.name} in ${region} according to TMDB. If this is a rent/buy store, pick the subscription service instead.`
        : `No titles with posters found for ${brand.name}.`,
    )
  }
  return posters
}

// Curated IDs, each verified against themoviedb.org/network/<id> and /company/<id>.
export const NETWORKS = [
  [213, 'Netflix'], [1024, 'Prime Video'], [2739, 'Disney+'], [453, 'Hulu'], [2552, 'Apple TV+'],
  [3186, 'HBO Max'], [49, 'HBO'], [4330, 'Paramount+'], [3353, 'Peacock'], [1112, 'Crunchyroll'],
  [247, 'YouTube'], [2, 'ABC'], [6, 'NBC'], [16, 'CBS'], [19, 'FOX'], [71, 'The CW'], [174, 'AMC'],
  [88, 'FX'], [67, 'Showtime'], [318, 'STARZ'], [41, 'TNT'], [68, 'TBS'], [30, 'USA Network'],
  [77, 'Syfy'], [47, 'Comedy Central'], [80, 'Adult Swim'], [56, 'Cartoon Network'], [13, 'Nickelodeon'],
  [54, 'Disney Channel'], [1267, 'Freeform'], [2087, 'Discovery Channel'], [43, 'National Geographic'],
  [65, 'History'], [74, 'Bravo'], [129, 'A&E'], [34, 'Lifetime'], [33, 'MTV'], [24, 'BET'], [14, 'PBS'],
  [384, 'Hallmark Channel'], [4, 'BBC One'], [332, 'BBC Two'], [9, 'ITV1'], [26, 'Channel 4'],
  [214, 'Sky One'], [1063, 'Sky Atlantic'],
].map(([id, name]) => ({ kind: 'network', id, name }))

export const STUDIOS = [
  [41077, 'A24'], [420, 'Marvel Studios'], [3, 'Pixar'], [2, 'Walt Disney Pictures'], [1, 'Lucasfilm'],
  [174, 'Warner Bros. Pictures'], [184898, 'DC Studios'], [33, 'Universal Pictures'], [6704, 'Illumination'],
  [4, 'Paramount Pictures'], [5, 'Columbia Pictures'], [127928, '20th Century Studios'], [43, 'Searchlight Pictures'],
  [1632, 'Lionsgate'], [521, 'DreamWorks Animation'], [10342, 'Studio Ghibli'], [882, 'TOHO'],
  [3172, 'Blumhouse'], [923, 'Legendary'], [90733, 'NEON'], [10146, 'Focus Features'], [21, 'MGM'],
  [12, 'New Line Cinema'], [56, 'Amblin Entertainment'],
].map(([id, name]) => ({ kind: 'company', id, name }))
