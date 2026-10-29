import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Match production's same-origin API URLs while keeping `npm run dev`
    // convenient. Set VITE_API_PROXY_TARGET when the local API is elsewhere.
    //
    // changeOrigin is intentionally left off: it would rewrite the Host
    // header to the proxy target (e.g. 127.0.0.1:8000), and the backend
    // builds absolute media URLs from that header via request.base_url.
    // Any client other than the machine running the backend itself (an
    // Android device/emulator, a phone on the LAN, ...) would then get
    // media URLs pointing at its own loopback address instead of the real
    // server, failing with a connection error.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        configure(proxy) {
          proxy.on('proxyRes', (response) => {
            // Connection lifetime belongs to each hop. Forwarding the API's
            // "close" to Android's connection to Vite intermittently truncates
            // larger responses in the emulator. Let the proxy choose the
            // downstream connection header from the client's request instead.
            delete response.headers.connection
            delete response.headers['keep-alive']
          })
        },
      },
    },
  },
})
