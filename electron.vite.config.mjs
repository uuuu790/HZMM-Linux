import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only CSP relaxation. index.html ships a strict production CSP
// (script-src 'self', no unsafe-inline/unsafe-eval). But the Vite dev server
// injects an inline React Fast Refresh preamble + HMR client and relies on
// eval, all of which that strict policy forbids — so `npm run dev` would white-
// screen. This plugin runs ONLY while serving (apply: 'serve', never on build)
// and rewrites the meta to the permissive policy the app used before hardening,
// so development is unchanged while the shipped build stays locked down.
function devCspPlugin() {
  const DEV_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
    "connect-src 'self' https: ws: wss:;"
  return {
    name: 'hzmm-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
        `<meta http-equiv="Content-Security-Policy" content="${DEV_CSP}" />`
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss(), devCspPlugin()]
  }
})
