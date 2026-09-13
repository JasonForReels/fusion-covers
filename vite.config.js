import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP is injected only into production builds (dev needs inline HMR scripts).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src https:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
    },
  ],
})
