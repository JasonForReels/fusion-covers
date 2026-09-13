import { useCallback, useEffect, useRef, useState } from 'react'
import { SyncEngine, newToken, savedToken } from './sync.js'

/**
 * Wires the sync engine to React state. `setProjectRaw` / `setSettingsRaw` must be the unstamped
 * setters, so data arriving from another device keeps that device's timestamps.
 */
export function useSync({ project, settings, setProjectRaw, setSettingsRaw }) {
  const local = useRef({ project, settings })
  local.current = { project, settings }

  const [status, setStatus] = useState({ state: savedToken() ? 'syncing' : 'off', message: '', at: 0 })
  const [token, setToken] = useState(savedToken)
  const engine = useRef(null)

  if (!engine.current) {
    engine.current = new SyncEngine({
      getLocal: () => local.current,
      applyRemote: (next) => {
        local.current = next // visible to the engine immediately, before React re-renders
        setProjectRaw(next.project)
        setSettingsRaw(next.settings)
      },
      onStatus: setStatus,
    })
  }

  useEffect(() => {
    const e = engine.current
    e.start()
    return () => e.stop()
  }, [])

  // Push shortly after any local change (no-op when nothing actually differs from the server).
  useEffect(() => {
    engine.current.changed()
  }, [project, settings])

  const connect = useCallback(async (t) => {
    setToken(t)
    await engine.current.connect(t)
  }, [])

  const create = useCallback(() => connect(newToken()), [connect])

  const disconnect = useCallback(() => {
    engine.current.disconnect()
    setToken(null)
  }, [])

  const destroy = useCallback(async () => {
    await engine.current.destroy()
    setToken(null)
  }, [])

  const syncNow = useCallback(() => engine.current.pull(), [])

  return { status, token, connect, create, disconnect, destroy, syncNow }
}
