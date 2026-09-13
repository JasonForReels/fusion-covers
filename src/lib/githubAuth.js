// "Sign in with GitHub": redirect through the sync Worker (which holds the OAuth client secret),
// then pick the token up from the URL fragment on return.
import { SYNC_URL } from './sync.js'
import { saveToken } from './storage.js'

const NONCE_KEY = 'covers.ghNonce'

let statusPromise = null
/** Resolves true when the Worker has GitHub sign-in configured. */
export function githubLoginAvailable() {
  if (!SYNC_URL) return Promise.resolve(false)
  statusPromise ??= fetch(`${SYNC_URL}/auth/github/status`, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((d) => !!d.enabled)
    .catch(() => false)
  return statusPromise
}

export function startGithubLogin() {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  sessionStorage.setItem(NONCE_KEY, nonce)
  const ret = location.href.split('#')[0]
  location.assign(`${SYNC_URL}/auth/github/start?${new URLSearchParams({ return: ret, nonce })}`)
}

/** Call once on load. Returns { token } | { error } | null. Always cleans the fragment. */
export function consumeGithubRedirect() {
  if (!location.hash.includes('gh_')) return null
  const params = new URLSearchParams(location.hash.slice(1))
  history.replaceState(null, '', location.pathname + location.search) // token out of the address bar & history
  const expected = sessionStorage.getItem(NONCE_KEY)
  sessionStorage.removeItem(NONCE_KEY)
  if (!expected || params.get('gh_nonce') !== expected) return { error: 'Sign-in could not be verified. Please try again.' }
  if (params.get('gh_error')) return { error: params.get('gh_error') }
  const token = params.get('gh_token')
  if (!token) return null
  saveToken(token, true)
  return { token }
}
