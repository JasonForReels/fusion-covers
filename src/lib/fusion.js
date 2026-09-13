import { uid } from './storage.js'

// Fusion widget export format (matched byte-for-byte against a real covers.betterer.cc export):
// { exportType: "fusionWidgets", exportVersion: 1, widgets: [ { type: "collection.row", id, title,
//   dataSource: { kind: "collection", payload: { items: [ { id, title, imageURL, imageAspect,
//   hideTitle, dataSources: [...] } ] } } } ] }

export const ASPECTS = {
  poster: { label: 'Poster', width: 557, height: 836 },
  wide: { label: 'Wide', width: 990, height: 557 },
  square: { label: 'Square', width: 557, height: 557 },
}

const PALETTE = [
  ['#7c5cff', '#1b1033'], ['#ff5c7a', '#2a0d18'], ['#20c997', '#062a22'], ['#ffa94d', '#2e1a05'],
  ['#4dabf7', '#0a1d33'], ['#f06595', '#2b0a1c'], ['#94d82d', '#172605'], ['#e8ebf3', '#1c2130'],
]

export function defaultDesign(seed = Math.floor(Math.random() * PALETTE.length)) {
  const [c1, c2] = PALETTE[seed % PALETTE.length]
  return {
    bg: 'gradient', c1, c2, angle: 135, image: '', dim: 0.35, posters: [], logo: null,
    text: true, font: 'sans', weight: 800, size: 1, pos: 'center', uppercase: false,
    color: '#ffffff', shadow: true,
  }
}

export const newLogo = (fields) => ({ preset: '', src: '', tint: 'original', color: '#ffffff', scale: 1, pos: 'center', ...fields })

export function newItem({ title = 'New collection', dataSources = [], aspect = 'wide', posters = [] } = {}) {
  const design = defaultDesign()
  if (posters.length) Object.assign(design, { bg: 'collage', posters: posters.slice(0, 12) })
  return { id: uid(), title, aspect, hideTitle: true, dataSources, design, imageURL: '' }
}

// Addon catalog payloads carry both spellings of the catalog type (see sources.js).
export function normalizeSource(ds) {
  if (ds?.kind !== 'addonCatalog') return ds
  const t = ds.payload.type ?? ds.payload.catalogType
  return t ? { ...ds, payload: { ...ds.payload, type: t, catalogType: t } } : ds
}

export function buildExport(project, imageUrls = {}) {
  return {
    exportType: 'fusionWidgets',
    exportVersion: 1,
    widgets: project.rows
      .filter((row) => row.items.length)
      .map((row) => ({
        dataSource: {
          kind: 'collection',
          payload: {
            items: row.items.map((item) => ({
              dataSources: item.dataSources.map(normalizeSource),
              hideTitle: item.hideTitle,
              id: item.id,
              imageAspect: item.aspect,
              imageURL: imageUrls[item.id] ?? item.imageURL ?? '',
              title: item.title,
            })),
          },
        },
        id: row.id.startsWith('collection.') ? row.id : `collection.${row.id}`,
        title: row.title,
        type: 'collection.row',
      })),
  }
}

export function validate(project) {
  const problems = []
  project.rows.forEach((row) => {
    row.items.forEach((item) => {
      if (!item.dataSources.length) problems.push(`“${item.title}” in “${row.title}” has no data source.`)
    })
  })
  if (!project.rows.some((r) => r.items.length)) problems.push('Add at least one cover.')
  return problems
}

// Import an existing Fusion export (ours, betterer.cc's, or hand-made) so it can be re-edited.
export function parseExport(json) {
  if (json?.exportType !== 'fusionWidgets' || !Array.isArray(json.widgets)) {
    throw new Error('Not a Fusion widgets export (expected exportType "fusionWidgets").')
  }
  const rows = json.widgets
    .filter((w) => w.type === 'collection.row')
    .map((w) => ({
      id: String(w.id ?? uid()).replace(/^collection\./, ''),
      title: w.title ?? 'Collection',
      items: (w.dataSource?.payload?.items ?? []).map((it) => {
        const design = defaultDesign()
        if (it.imageURL) Object.assign(design, { bg: 'image', image: it.imageURL, dim: 0, text: false })
        return {
          id: it.id ?? uid(),
          title: it.title ?? '',
          aspect: ASPECTS[it.imageAspect] ? it.imageAspect : 'wide',
          hideTitle: it.hideTitle ?? true,
          dataSources: it.dataSources ?? [],
          design,
          imageURL: it.imageURL ?? '',
        }
      }),
    }))
  if (!rows.length) throw new Error('No collection rows found in that export.')
  return { rows }
}

export function describeSource(ds) {
  const p = ds.payload ?? {}
  if (ds.kind === 'addonCatalog') return { label: p.catalogId, detail: hostOf(p.addonId) }
  if (ds.kind === 'traktList') return { label: p.listName ?? p.listSlug, detail: `trakt · @${p.username}` }
  return { label: ds.kind, detail: JSON.stringify(p).slice(0, 60) }
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
