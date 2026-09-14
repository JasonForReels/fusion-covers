// "Host with Covers": publishes config.json + cover images to the sync Worker, no GitHub needed.
// The host id is random and only its secret can change it; the secret travels in (encrypted) sync.

import { SYNC_URL } from './sync.js'

export const hostingAvailable = () => !!SYNC_URL

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
export const newHost = () => ({ id: hex(crypto.getRandomValues(new Uint8Array(16))), secret: hex(crypto.getRandomValues(new Uint8Array(32))) })
export const hostedUrl = (host) => `${SYNC_URL}/h/${host.id}/config.json`

const sha256 = async (blob) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))

const ERRORS = {
  host_full: 'Hosted space is full (12 MB). Remove some covers or publish to GitHub instead.',
  too_many_files: 'Too many covers for hosting (300 max). Publish to GitHub instead.',
  file_too_large: 'A cover image is too large to host.',
  forbidden: 'This hosted URL belongs to another device’s key. Start a new hosted URL.',
  unavailable: 'Hosting is busy (free-tier daily limit). Try again later.',
}

async function call(host, method, path, body, type) {
  let res
  try {
    res = await fetch(`${SYNC_URL}/h/${host.id}${path}`, {
      method,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${host.secret}`, ...(type ? { 'Content-Type': type } : {}) },
      body,
    })
  } catch {
    throw new Error('Could not reach the hosting server.')
  }
  if (!res.ok) {
    const code = (await res.json().catch(() => ({}))).error
    throw new Error(ERRORS[code] ?? `Hosting failed (${res.status}${code ? ` ${code}` : ''}).`)
  }
  return res.status === 204 ? null : res.json()
}

/** images: [{ id, name, blob }]; buildConfig(urlFor) → Fusion export. Returns { url, urlFor }. */
export async function publishHosted(host, images, buildConfig, log = () => {}) {
  log('Checking hosted files…')
  const { files } = await call(host, 'GET', '')
  const urlFor = {}
  const keep = []
  for (const [i, img] of images.entries()) {
    const name = `covers/${img.name}`
    const hash = await sha256(img.blob)
    keep.push(name)
    if (files[name] !== hash) {
      log(`Uploading cover ${i + 1}/${images.length}…`)
      await call(host, 'PUT', `/${name}`, img.blob, img.blob.type)
    }
    urlFor[img.id] = `${SYNC_URL}/h/${host.id}/${name}?v=${hash.slice(0, 10)}`
  }
  log('Writing config.json…')
  await call(host, 'PUT', '', JSON.stringify({ config: buildConfig(urlFor), keep }), 'application/json')
  log('Done ✓')
  return { url: hostedUrl(host), urlFor }
}

export const deleteHosted = (host) => call(host, 'DELETE', '')
