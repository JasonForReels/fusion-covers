import { useCallback, useEffect, useMemo, useState } from 'react'
import { stampProject, stampSettings } from './lib/merge.js'
import { useSync } from './lib/useSync.js'
import { consumeGithubRedirect } from './lib/githubAuth.js'
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

  // Returning from "Sign in with GitHub": grab the token and reopen Publish.
  useEffect(() => {
    const r = consumeGithubRedirect()
    if (r?.token) {
      toast('Signed in with GitHub')
      setDialog('publish')
    } else if (r?.error) toast(r.error, true)
  }, [toast])

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
    async ({ title, dataSource, dataSources = dataSource ? [dataSource] : [], loadPosters }) => {
      const rowId = selected?.rowId ?? project.rows.at(-1)?.id
      const item = newItem({ title, dataSources })
      if (!rowId) {
        const row = { id: uid(), title: 'My Collections', items: [item] }
        setProject((p) => ({ ...p, rows: [...p.rows, row] }))
        setSelected({ rowId: row.id, itemId: item.id })
      } else {
        patchRow(rowId, (r) => ({ ...r, items: [...r.items, item] }))
        setSelected({ rowId, itemId: item.id })
      }
      toast(`Added “${title}”${dataSources.length > 1 ? ` with ${dataSources.length} sources` : ''}`)

      // Fetch a few posters for a collage background (best effort, straight from the source).
      try {
        const first = dataSources[0]
        const p = first?.payload
        const posters = loadPosters
          ? await loadPosters()
          : first?.kind === 'addonCatalog'
            ? await addonPosters(p.addonId, p.type ?? p.catalogType, p.catalogId)
            : first?.kind === 'traktList'
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
    [selected, project.rows, patchRow, patchItem, setProject, settings.traktClientId, toast],
  )

  // Bulk: a new row with one cover per list; posters are fetched one cover at a time in the background.
  const createRow = useCallback(
    async ({ title, covers }) => {
      const items = covers.map((c) => newItem({ title: c.title, dataSources: c.dataSources }))
      const row = { id: uid(), title, items }
      setProject((p) => ({ ...p, rows: p.rows.length === 1 && !p.rows[0].items.length ? [row] : [...p.rows, row] }))
      setSelected({ rowId: row.id, itemId: null })
      toast(`Created “${title}” with ${items.length} collection${items.length > 1 ? 's' : ''}`)
      for (const item of items) {
        const p = item.dataSources.find((d) => d.kind === 'addonCatalog')?.payload
        if (!p) continue
        try {
          const posters = await addonPosters(p.addonId, p.type ?? p.catalogType, p.catalogId)
          if (posters.length) patchItem(item.id, (it) => (it.design.bg === 'gradient' ? { ...it, design: { ...it.design, bg: 'collage', posters } } : it))
        } catch {
          // Keep the gradient cover.
        }
      }
    },
    [setProject, patchItem, toast],
  )

  const attachSource = useCallback(
    (dataSourceOrList) => {
      if (!selectedItem) return
      const incoming = [dataSourceOrList].flat()
      const have = new Set(selectedItem.dataSources.map((d) => JSON.stringify(d)))
      const fresh = incoming.filter((d) => !have.has(JSON.stringify(d)))
      if (!fresh.length) return toast('Already attached')
      patchItem(selectedItem.id, (it) => ({ ...it, dataSources: [...it.dataSources, ...fresh] }))
      toast(`Attached ${fresh.length} source${fresh.length > 1 ? 's' : ''} to “${selectedItem.title}”`)
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
          onCreateRow={createRow}
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
