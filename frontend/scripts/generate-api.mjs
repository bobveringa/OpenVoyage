import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptRoot = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptRoot, '..')
const repoRoot = resolve(frontendRoot, '..')
const specRelativePath = 'src/api/openapi.json'
const typesRelativePath = 'src/api/types.ts'
const specPath = resolve(frontendRoot, specRelativePath)
const backendExporter = resolve(repoRoot, 'backend/scripts/export_openapi.py')

function resolvePython() {
  if (process.env.PYTHON) {
    return process.env.PYTHON
  }

  const venvPython =
    process.platform === 'win32'
      ? resolve(repoRoot, '.venv/Scripts/python.exe')
      : resolve(repoRoot, '.venv/bin/python')

  if (existsSync(venvPython)) {
    return venvPython
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

function resolveOpenApiCli() {
  const packageJsonPath = require.resolve('openapi-typescript/package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const binPath =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin['openapi-typescript']

  return resolve(dirname(packageJsonPath), binPath)
}

function run(label, command, args, cwd) {
  console.log(`\n> ${label}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('Export FastAPI OpenAPI schema', resolvePython(), [backendExporter, specPath], repoRoot)
run(
  'Generate TypeScript API types',
  process.execPath,
  [resolveOpenApiCli(), specRelativePath, '-o', typesRelativePath],
  frontendRoot,
)
