// Conflict-free-ish merging so two devices can edit at the same time without losing work.
// Every row and item carries `updatedAt`; deletions leave short-lived tombstones; row order has
// its own timestamp. Merge = newest version of each thing wins, deletes win over older edits.

const TOMBSTONE_TTL = 90 * 24 * 3600 * 1000

const strip = ({ updatedAt, ...rest }) => rest
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const rowShape = (row) => ({ title: row.title, itemIds: row.items.map((i) => i.id) })

/** Stamp timestamps on whatever changed between two local project states. */
export function stampProject(prev, next, now = Date.now()) {
  if (prev === next) return next
  const prevRows = new Map((prev?.rows ?? []).map((r) => [r.id, r]))
  const prevItems = new Map((prev?.rows ?? []).flatMap((r) => r.items).map((i) => [i.id, i]))
  const prevHome = new Map((prev?.rows ?? []).flatMap((r) => r.items.map((i) => [i.id, r.id])))
  const nextIds = new Set(next.rows.flatMap((r) => [r.id, ...r.items.map((i) => i.id)]))

  const rows = next.rows.map((row) => {
    const items = row.items.map((item) => {
      const old = prevItems.get(item.id)
      // Moving an item to another row counts as an edit, so the move syncs.
      if (old && prevHome.get(item.id) === row.id && same(strip(old), strip(item))) return old.updatedAt ? { ...item, updatedAt: old.updatedAt } : item
      return { ...item, updatedAt: now }
    })
    const old = prevRows.get(row.id)
    const changed = !old || !same(rowShape(old), rowShape(row))
    return { ...row, items, updatedAt: changed ? now : (old.updatedAt ?? now) }
  })

  const deleted = { ...(next.deleted ?? prev?.deleted ?? {}) }
  for (const id of [...prevRows.keys(), ...prevItems.keys()]) if (!nextIds.has(id)) deleted[id] = now
  for (const id of nextIds) delete deleted[id]

  const orderChanged = !same((prev?.rows ?? []).map((r) => r.id), rows.map((r) => r.id))
  return { ...next, rows, deleted, orderAt: orderChanged ? now : (prev?.orderAt ?? next.orderAt ?? 0) }
}

const alive = (thing, deleted) => thing && !((deleted[thing.id] ?? 0) >= (thing.updatedAt ?? 0))
const newer = (a, b) => (!a ? b : !b ? a : (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a)

export function mergeProjects(local, remote, now = Date.now()) {
  if (!remote) return local
  if (!local) return remote

  const deleted = {}
  for (const [id, t] of [...Object.entries(local.deleted ?? {}), ...Object.entries(remote.deleted ?? {})]) {
    if (now - t < TOMBSTONE_TTL) deleted[id] = Math.max(deleted[id] ?? 0, t)
  }

  const items = new Map()
  const homeRow = new Map() // item id -> row id it lives in on the side that last touched it
  for (const side of [local, remote]) {
    for (const row of side.rows) {
      for (const item of row.items) {
        const pick = newer(items.get(item.id), item)
        items.set(item.id, pick)
        if (pick === item) homeRow.set(item.id, row.id)
      }
    }
  }

  const rowsById = new Map()
  for (const side of [local, remote]) for (const row of side.rows) rowsById.set(row.id, newer(rowsById.get(row.id), row))

  const orderSource = (remote.orderAt ?? 0) > (local.orderAt ?? 0) ? remote : local
  const other = orderSource === remote ? local : remote
  const order = [...orderSource.rows.map((r) => r.id), ...other.rows.map((r) => r.id).filter((id) => !orderSource.rows.some((r) => r.id === id))]

  const placed = new Set()
  const rows = order
    .map((id) => rowsById.get(id))
    .filter((row) => alive(row, deleted))
    .map((row) => ({
      ...row,
      items: row.items
        .map((i) => items.get(i.id))
        // An item belongs to the row it was in when last edited (handles moves between rows).
        .filter((i) => alive(i, deleted) && homeRow.get(i.id) === row.id && !placed.has(i.id) && placed.add(i.id)),
    }))

  // Items that survived but aren't in any winning row's order (e.g. added on another device
  // to a row that was renamed here) go back to their home row, or the first row.
  for (const item of items.values()) {
    if (!alive(item, deleted) || placed.has(item.id)) continue
    const target = rows.find((r) => r.id === homeRow.get(item.id)) ?? rows[0]
    if (target) {
      target.items.push(item)
      placed.add(item.id)
    }
  }

  return { ...local, rows, deleted, orderAt: Math.max(local.orderAt ?? 0, remote.orderAt ?? 0) }
}

/* ---------- settings: only non-device-specific fields sync, last writer wins ---------- */

export const SYNCED_SETTINGS = ['traktClientId', 'tmdbKey', 'region', 'manifests', 'useImageProxy', 'github']

export const pickSynced = (s) => Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, s[k]]))

export function stampSettings(prev, next, now = Date.now()) {
  if (prev === next) return next
  return same(pickSynced(prev), pickSynced(next)) ? { ...next, syncedAt: prev.syncedAt ?? 0 } : { ...next, syncedAt: now }
}

export function mergeSettings(local, remote) {
  if (!remote || (remote.syncedAt ?? 0) <= (local.syncedAt ?? 0)) return local
  return { ...local, ...pickSynced(remote), syncedAt: remote.syncedAt }
}
