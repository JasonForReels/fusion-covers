// Brand marks from Simple Icons (CC0, bundled locally — no network requests).
// Prime Video, Disney+, Hulu and Peacock are not in Simple Icons; upload those via URL/file.
// Trademarks belong to their owners.
import { siNetflix, siAppletv, siMax, siHbomax, siHbo, siParamountplus, siCrunchyroll, siYoutube, siYoutubetv, siPlex, siJellyfin, siStarz, siShowtime, siMubi, siTubi, siFubo, siRoku, siTwitch, siItvx, siChannel4, siSky, siViaplay, siDazn, siApple, siTrakt, siImdb, siThemoviedatabase, siLetterboxd, siAnilist, siMyanimelist, siKodi, siStremio, siTvtime } from 'simple-icons'

import disneyPlusLogo from '../assets/logos/disney-plus.png'

// Which TMDB streaming provider (matched by name for the user's region) and/or TV network each mark
// represents, so picking a logo can fill the collage with that brand's actual titles.
const BRAND_HINTS = {
  netflix: { provider: 'Netflix', network: 213 },
  appletv: { provider: ['Apple TV+', 'Apple TV Plus', 'Apple TV'], network: 2552 },
  max: { provider: ['HBO Max', 'Max'], network: 3186 },
  hbomax: { provider: ['HBO Max', 'Max'], network: 3186 },
  hbo: { network: 49, name: 'HBO' },
  paramountplus: { provider: ['Paramount Plus', 'Paramount+'], network: 4330 },
  crunchyroll: { provider: 'Crunchyroll', network: 1112 },
  youtube: { network: 247, name: 'YouTube' },
  youtubetv: { network: 247, name: 'YouTube' },
  plex: { provider: 'Plex' },
  starz: { provider: 'Starz', network: 318 },
  showtime: { provider: ['Paramount+ with Showtime', 'Showtime'], network: 67 },
  mubi: { provider: 'MUBI' },
  tubi: { provider: 'Tubi' },
  fubo: { provider: ['fuboTV', 'Fubo'] },
  roku: { provider: 'The Roku Channel' },
  itvx: { provider: 'ITVX', network: 9 },
  channel4: { provider: 'Channel 4', network: 26 },
  sky: { provider: ['Sky Go', 'Now TV'], network: 1063 },
  viaplay: { provider: 'Viaplay' },
  disneyplus: { provider: ['Disney Plus', 'Disney+'], network: 2739 },
}

export const LOGOS = [siNetflix, siAppletv, siMax, siHbomax, siHbo, siParamountplus, siCrunchyroll, siYoutube, siYoutubetv, siPlex, siJellyfin, siStarz, siShowtime, siMubi, siTubi, siFubo, siRoku, siTwitch, siItvx, siChannel4, siSky, siViaplay, siDazn, siApple, siTrakt, siImdb, siThemoviedatabase, siLetterboxd, siAnilist, siMyanimelist, siKodi, siStremio, siTvtime].map((i) => ({
  id: i.slug,
  title: i.title,
  hex: '#' + i.hex,
  path: i.path,
  brand: BRAND_HINTS[i.slug] ? { name: i.title, ...BRAND_HINTS[i.slug] } : null,
}))

// Wordmarks that aren't in Simple Icons, bundled as white-on-transparent PNGs so they can be
// recolored. `src` images are drawn with the image renderer instead of an SVG path.
// Disney+ wordmark extracted from disneyplus.com (lumiere-a.akamaihd.net), cropped and whitened.
const IMAGE_LOGOS = [
  { id: 'disneyplus', title: 'Disney+', hex: '#113CCF', src: disneyPlusLogo, defaultTint: 'white' },
]

LOGOS.unshift(...IMAGE_LOGOS.map((l) => ({ ...l, brand: { name: l.title, ...BRAND_HINTS[l.id] } })))

export const logoById = (id) => LOGOS.find((l) => l.id === id)
