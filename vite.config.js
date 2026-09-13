import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP is injected only into production builds (dev needs inline HMR scripts).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src https: __SYNC_ORIGIN__",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  // Allow a plain-http local sync server in the CSP only when that's what the build points at.
  const syncOrigin = env.VITE_SYNC_URL?.startsWith('http://') ? new URL(env.VITE_SYNC_URL).origin : ''
  return {
  base: './',
  plugins: [
    react(),
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP.replace('__SYNC_ORIGIN__', syncOrigin).trim()}">`),
    },
  ],
}
})
