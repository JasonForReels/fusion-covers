import { useCallback, useEffect, useMemo, useState } from 'react'
import { stampProject, stampSettings } from './lib/merge.js'
import { useSync } from './lib/useSync.js'
import SyncDialog, { SyncBadge } from './components/SyncDialog.jsx'
import { loadProject, saveProject, loadSettings, saveSettings, uid } from './lib/storage.js'
import { newItem } from './lib/fusion.js'
import { addonPosters, traktPosters } from './lib/sources.js'
import SourcesPanel from './components/SourcesPanel.jsx'
import Board from './components/Board.jsx'
import Editor from './components/Editor.jsx'
import { SettingsDialog, PublishDialog, ImportDialog } from './components/Dialogs.jsx'
import { ToastProvider, useToast } from './components/Toast.jsx'

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell() {
  const toast = useToast()
  const [project, setProjectRaw] = useState(loadProject)
  const [settings, setSettingsRaw] = useState(loadSettings)
  // Local edits get change timestamps so sync can merge edits from several devices.
  const setProject = useCallback((u) => setProjectRaw((prev) => stampProject(prev, typeof u === 'function' ? u(prev) : u)), [])
  const setSettings = useCallback((u) => setSettingsRaw((prev) => stampSettings(prev, typeof u === 'function' ? u(prev) : u)), [])
  const sync = useSync({ project, settings, setProjectRaw, setSettingsRaw })
  const [selected, setSelected] = useState(null) // { rowId, itemId }
  const [dialog, setDialog] = useState(null)

  useEffect(() => saveProject(project), [project])
  useEffect(() => saveSettings(settings), [settings])

  const patchRow = useCallback((rowId, fn) => {
    setProject((p) => ({ ...p, rows: p.rows.map((r) => (r.id === rowId ? fn(r) : r)) }))
  }, [])

  const patchItem = useCallback((itemId, fn) => {
    setProject((p) => ({
      ...p,
      rows: p.rows.map((r) => ({ ...r, items: r.items.map((it) => (it.id === itemId ? fn(it) : it)) })),
    }))
  }, [])

  const selectedItem = useMemo(() => {
    if (!selected) return null
    return project.rows.find((r) => r.id === selected.rowId)?.items.find((i) => i.id === selected.itemId) ?? null
  }, [project, selected])

  const addCover = useCallback(
    async ({ title, dataSource }) => {
      const rowId = selected?.rowId ?? project.rows.at(-1)?.id
      const item = newItem({ title, dataSources: [dataSource] })
      if (!rowId) {
        const row = { id: uid(), title: 'My Collections', items: [item] }
        setProject((p) => ({ ...p, rows: [...p.rows, row] }))
        setSelected({ rowId: row.id, itemId: item.id })
      } else {
        patchRow(rowId, (r) => ({ ...r, items: [...r.items, item] }))
        setSelected({ rowId, itemId: item.id })
      }
      toast(`Added “${title}”`)

      // Fetch a few posters for a collage background (best effort, straight from the source).
      try {
        const p = dataSource.payload
        const posters =
          dataSource.kind === 'addonCatalog'
            ? await addonPosters(p.addonId, p.type, p.catalogId)
            : dataSource.kind === 'traktList'
              ? await traktPosters(p, settings.traktClientId)
              : []
        if (posters.length) {
          patchItem(item.id, (it) =>
            it.design.bg === 'gradient' ? { ...it, design: { ...it.design, bg: 'collage', posters } } : it,
          )
        }
      } catch {
        // No posters is fine — the gradient cover stays.
      }
    },
    [selected, project.rows, patchRow, patchItem, settings.traktClientId, toast],
  )

  const attachSource = useCallback(
    (dataSource) => {
      if (!selectedItem) return
      const key = JSON.stringify(dataSource)
      if (selectedItem.dataSources.some((d) => JSON.stringify(d) === key)) return toast('Already attached')
      patchItem(selectedItem.id, (it) => ({ ...it, dataSources: [...it.dataSources, dataSource] }))
      toast(`Attached to “${selectedItem.title}”`)
    },
    [selectedItem, patchItem, toast],
  )

  const removeItem = (itemId) => {
    setProject((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, items: r.items.filter((i) => i.id !== itemId) })) }))
    setSelected(null)
  }

  const duplicateItem = (rowId, item) => {
    const copy = { ...structuredClone(item), id: uid(), title: `${item.title} copy` }
    patchRow(rowId, (r) => {
      const idx = r.items.findIndex((i) => i.id === item.id)
      const items = [...r.items]
      items.splice(idx + 1, 0, copy)
      return { ...r, items }
    })
    setSelected({ rowId, itemId: copy.id })
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo">🎞️</span> <b>Covers</b> <span className="muted">for Fusion · no server, no tracking</span>
        </div>
        <div className="actions">
          <SyncBadge status={sync.status} connected={!!sync.token} onClick={() => setDialog('sync')} />
          <button className="ghost" onClick={() => setDialog('import')}>Import</button>
          <button className="ghost" onClick={() => setDialog('settings')}>Settings</button>
          <button className="primary" onClick={() => setDialog('publish')}>Publish</button>
        </div>
      </header>

      <main className={`layout ${selectedItem ? 'with-editor' : ''}`}>
        <SourcesPanel
          settings={settings}
          setSettings={setSettings}
          onAddCover={addCover}
          onAttach={selectedItem ? attachSource : null}
          openSettings={() => setDialog('settings')}
        />
        <Board
          project={project}
          setProject={setProject}
          patchRow={patchRow}
          selected={selected}
          select={setSelected}
          settings={settings}
        />
        {selectedItem && (
          <Editor
            key={selectedItem.id}
            item={selectedItem}
            patch={(fn) => patchItem(selectedItem.id, fn)}
            onRemove={() => removeItem(selectedItem.id)}
            onDuplicate={() => duplicateItem(selected.rowId, selectedItem)}
            onClose={() => setSelected(null)}
            settings={settings}
          />
        )}
      </main>

      {dialog === 'sync' && <SyncDialog sync={sync} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && (
        <SettingsDialog settings={settings} setSettings={setSettings} onClose={() => setDialog(null)} />
      )}
      {dialog === 'publish' && (
        <PublishDialog
          project={project}
          settings={settings}
          setSettings={setSettings}
          // Remember each cover's published GitHub URL; other synced devices fall back to it.
          onPublished={(urlFor) =>
            setProject((p) => ({
              ...p,
              rows: p.rows.map((r) => ({ ...r, items: r.items.map((i) => (urlFor[i.id] ? { ...i, imageURL: urlFor[i.id] } : i)) })),
            }))
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'import' && (
        <ImportDialog
          onImport={(p) => {
            setProject(p)
            setSelected(null)
            setDialog(null)
            toast(`Imported ${p.rows.length} row(s)`)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}
