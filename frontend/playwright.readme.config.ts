import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const baseURL = 'http://localhost:5184'

export default defineConfig({
  testDir: './tests/readme-preview',
  outputDir: fileURLToPath(new URL('../private/artifacts/readme-preview/', import.meta.url)),
  reporter: 'list',
  timeout: 90_000,
  use: { baseURL, browserName: 'chromium' },
  webServer: {
    command: 'npm run dev -- --host localhost --port 5184 --strictPort',
    env: { VITE_API_BASE_URL: baseURL },
    url: baseURL,
  },
})
