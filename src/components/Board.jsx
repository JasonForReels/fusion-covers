import { useState } from 'react'
import { uid } from '../lib/storage.js'
import CoverCanvas from './CoverCanvas.jsx'

const move = (arr, from, to) => {
  const next = [...arr]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

export default function Board({ project, setProject, patchRow, selected, select, settings }) {
  const [drag, setDrag] = useState(null) // { rowId, index }

  const moveRow = (index, dir) =>
    setProject((p) => {
      const to = index + dir
      return to < 0 || to >= p.rows.length ? p : { ...p, rows: move(p.rows, index, to) }
    })

  const removeRow = (row) => {
    if (row.items.length && !confirm(`Delete “${row.title}” and its ${row.items.length} cover(s)?`)) return
    setProject((p) => ({ ...p, rows: p.rows.filter((r) => r.id !== row.id) }))
    if (selected?.rowId === row.id) select(null)
  }

  const dropOn = (row, index) => {
    if (!drag) return
    setProject((p) => {
      const source = p.rows.find((r) => r.id === drag.rowId)
      const item = source?.items[drag.index]
      if (!item) return p
      return {
        ...p,
        rows: p.rows.map((r) => {
          let items = r.items
          if (r.id === drag.rowId) items = items.filter((_, i) => i !== drag.index)
          if (r.id === row.id) {
            const at = r.id === drag.rowId && drag.index < index ? index - 1 : index
            items = [...items.slice(0, at), item, ...items.slice(at)]
          }
          return { ...r, items }
        }),
      }
    })
    if (selected?.itemId) select({ rowId: row.id, itemId: selected.itemId })
    setDrag(null)
  }

  const empty = !project.rows.some((r) => r.items.length)

  return (
    <section className="board">
      {project.rows.map((row, rowIndex) => (
        <div key={row.id} className="rowcard">
          <div className="rowhead">
            <input
              value={row.title}
              aria-label="Row title"
              onChange={(e) => patchRow(row.id, (r) => ({ ...r, title: e.target.value }))}
            />
            <div className="ctl">
              <button className="icon" title="Move up" onClick={() => moveRow(rowIndex, -1)}>↑</button>
              <button className="icon" title="Move down" onClick={() => moveRow(rowIndex, 1)}>↓</button>
              <button className="icon danger" title="Delete row" onClick={() => removeRow(row)}>🗑</button>
            </div>
          </div>
          <div
            className="items"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropOn(row, row.items.length)}
          >
            {row.items.map((item, i) => {
              const isSel = selected?.itemId === item.id
              return (
                <div
                  key={item.id}
                  className={`item ${isSel ? 'selected' : ''}`}
                  draggable
                  onDragStart={() => setDrag({ rowId: row.id, index: i })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.stopPropagation(); dropOn(row, i) }}
                  onClick={() => select(isSel ? null : { rowId: row.id, itemId: item.id })}
                  title={item.title}
                >
                  <CoverCanvas item={item} settings={settings} />
                  {!item.dataSources.length && <span className="warn">no source</span>}
                  <div className="cap">{item.title} · {item.dataSources.length} src</div>
                </div>
              )
            })}
            {!row.items.length && <p className="hint">Add covers from the left panel, or drag one here.</p>}
          </div>
          <button className="ghost small" onClick={() => select(selected?.rowId === row.id && !selected.itemId ? null : { rowId: row.id, itemId: null })}>
            {selected?.rowId === row.id ? '● New covers go here' : 'Send new covers here'}
          </button>
        </div>
      ))}
      <button
        className="ghost block dashed"
        onClick={() => {
          const row = { id: uid(), title: 'New row', items: [] }
          setProject((p) => ({ ...p, rows: [...p.rows, row] }))
          select({ rowId: row.id, itemId: null })
        }}
      >
        + Add collection row
      </button>
      {empty && (
        <p className="hint center">
          Load a Stremio addon or Trakt list on the left, then hit <b>+ Cover</b>. Everything is saved in this browser only.
        </p>
      )}
    </section>
  )
}
