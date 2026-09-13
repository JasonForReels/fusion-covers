// All state lives in this browser only. Nothing is sent anywhere unless the user publishes.

const PROJECT_KEY = 'covers.project.v1'
const SETTINGS_KEY = 'covers.settings.v1'
const SECRET_KEY = 'covers.githubToken'

function read(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded (large uploaded images) or storage blocked — keep working in memory.
  }
}

export const uid = () => crypto.randomUUID().toUpperCase()

export const defaultProject = () => ({ rows: [{ id: uid(), title: 'My Collections', items: [] }] })

export const defaultSettings = () => ({
  traktClientId: '',
  tmdbKey: '',
  region: 'US',
  manifests: [],
  useImageProxy: false,
  github: { owner: '', repo: '', branch: 'main', dir: 'fusion' },
  rememberToken: false,
  lastUrl: '',
})

export const loadProject = () => read(localStorage, PROJECT_KEY, null) ?? defaultProject()
export const saveProject = (p) => write(localStorage, PROJECT_KEY, p)

export const loadSettings = () => ({ ...defaultSettings(), ...read(localStorage, SETTINGS_KEY, {}) })
export const saveSettings = (s) => write(localStorage, SETTINGS_KEY, s)

// The GitHub token is kept in sessionStorage (gone when the tab closes) unless the user opts in.
export function loadToken() {
  return read(sessionStorage, SECRET_KEY, null) ?? read(localStorage, SECRET_KEY, '') ?? ''
}

export function saveToken(token, remember) {
  write(sessionStorage, SECRET_KEY, token)
  if (remember) write(localStorage, SECRET_KEY, token)
  else localStorage.removeItem(SECRET_KEY)
}

export function wipeEverything() {
  for (const k of [PROJECT_KEY, SETTINGS_KEY, SECRET_KEY]) {
    localStorage.removeItem(k)
    sessionStorage.removeItem(k)
  }
}
