import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

loadRootEnvFile()

const apiBaseUrl =
  process.env.E2E_API_BASE_URL ??
  process.env.VITE_API_BASE_URL ??
  'http://127.0.0.1:8000'

export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'npm run dev -- --host localhost --port 5173',
    env: {
      VITE_API_BASE_URL: apiBaseUrl,
    },
    reuseExistingServer: true,
    timeout: 120_000,
    url: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})

function loadRootEnvFile() {
  const configDirectory = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.resolve(configDirectory, '..', '.env')

  if (!fs.existsSync(envPath)) {
    return
  }

  const envFile = fs.readFileSync(envPath, 'utf8')

  for (const line of envFile.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }

    const assignmentStart = trimmedLine.startsWith('export ')
      ? trimmedLine.slice('export '.length)
      : trimmedLine
    const equalsIndex = assignmentStart.indexOf('=')

    if (equalsIndex === -1) {
      continue
    }

    const key = assignmentStart.slice(0, equalsIndex).trim()
    const rawValue = assignmentStart.slice(equalsIndex + 1).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) {
      continue
    }

    process.env[key] = parseEnvValue(rawValue)
  }
}

function parseEnvValue(value: string) {
  const quote = value[0]

  if (
    quote &&
    (quote === '"' || quote === "'") &&
    value.endsWith(quote)
  ) {
    return value.slice(1, -1)
  }

  return value
}
