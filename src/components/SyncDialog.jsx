import { useEffect, useRef, useState } from 'react'
import { parseToken, SYNC_URL } from '../lib/sync.js'
import { useToast } from './Toast.jsx'

const LABELS = {
  off: 'Sync off',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  error: 'Sync error',
}

export function SyncBadge({ status, connected, onClick }) {
  const state = connected ? status.state : 'off'
  return (
    <button className={`ghost syncbadge ${state}`} onClick={onClick} title={status.message || LABELS[state]}>
      <span className="dot" /> {LABELS[state]}
    </button>
  )
}

function ago(at) {
  if (!at) return ''
  const s = Math.round((Date.now() - at) / 1000)
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

export default function SyncDialog({ sync, onClose }) {
  const toast = useToast()
  const ref = useRef(null)
  const [paste, setPaste] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    const el = ref.current
    el.showModal()
    const t = setInterval(() => tick((n) => n + 1), 5000)
    return () => {
      clearInterval(t)
      el.close()
    }
  }, [])

  async function act(fn, done) {
    setBusy(true)
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      toast(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(sync.token)
      toast('Token copied — paste it on your other device')
    } catch {
      setReveal(true)
      toast('Clipboard blocked — select the token and copy it manually.', true)
    }
  }

  const parsed = parseToken(paste)
  const { state, message, at } = sync.status

  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose() }} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dlg">
        <h2>Sync</h2>

        {!SYNC_URL && <p className="hint warntext">This build has no sync server configured.</p>}

        {!sync.token ? (
          <>
            <p className="hint">
              One token keeps your collections, covers and settings in sync across browsers and devices. No account, no email.
              Everything is encrypted on this device before it's uploaded — the server can't read it.
            </p>

            <fieldset>
              <legend>First device</legend>
              <button className="primary block" disabled={busy || !SYNC_URL} onClick={() => act(sync.create, 'Sync is on — copy your token')}>
                Turn on sync
              </button>
            </fieldset>

            <fieldset>
              <legend>Already have a token?</legend>
              <div className="urlbox">
                <input
                  value={paste}
                  placeholder="fc1_…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setPaste(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && parsed && act(() => sync.connect(parsed), 'Connected — syncing')}
                />
                <button className="primary" disabled={!parsed || busy || !SYNC_URL} onClick={() => act(() => sync.connect(parsed), 'Connected — syncing')}>
                  Connect
                </button>
              </div>
              {paste && !parsed && <p className="hint warntext">That doesn't look like a sync token.</p>}
              <p className="hint">Anything already on this device is merged in, not overwritten.</p>
            </fieldset>
          </>
        ) : (
          <>
            <p className={`syncstate ${state}`}>
              <span className="dot" /> {LABELS[state]}
              {state === 'synced' && at ? <span className="muted"> · {ago(at)}</span> : null}
              {message && state !== 'synced' ? <span className="muted"> · {message}</span> : null}
            </p>

            <label>Your sync token</label>
            <div className="urlbox">
              <input
                readOnly
                type={reveal ? 'text' : 'password'}
                value={sync.token}
                onFocus={(e) => { setReveal(true); e.target.select() }}
              />
              <button className="primary" onClick={copy}>Copy</button>
            </div>
            <p className="hint">
              Paste this on any other browser or device (Sync › Already have a token). Keep it private — whoever has it can
              see and edit your collections. If you lose it and clear this browser, the synced data can't be recovered.
            </p>

            <div className="row2">
              <button disabled={busy} onClick={() => act(sync.syncNow)}>Sync now</button>
              <button disabled={busy} onClick={() => { sync.disconnect(); toast('Sync turned off on this device') }}>Stop syncing here</button>
            </div>
            <button
              className="danger block"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() => {
                if (confirm('Delete the synced copy from the server? Every device will stop syncing. Data already on each device stays there.')) {
                  act(sync.destroy, 'Synced data deleted')
                }
              }}
            >
              Delete synced data
            </button>
          </>
        )}

        <div className="dlg-actions">
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  )
}
