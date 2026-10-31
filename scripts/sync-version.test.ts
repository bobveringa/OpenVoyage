import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pythonVersion, repoRoot, syncVersion } from './sync-version.ts'

function fixture(t: TestContext) {
  const artifacts = join(repoRoot, 'private/artifacts/release-tests')
  mkdirSync(artifacts, { recursive: true })
  const root = mkdtempSync(join(artifacts, 'sync-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path: string, content: string) => {
    const fullPath = join(root, path)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, content)
  }
  const json = (path: string, content: unknown) => write(path, JSON.stringify(content, null, 2) + '\n')
  json('package.json', { version: '0.5.0' })
  for (const path of ['package-lock.json', 'frontend/package-lock.json']) {
    json(path, { version: '0.4.0', packages: { '': { version: '0.4.0' }, dependency: { version: '0.4.0' } } })
  }
  json('frontend/package.json', { version: '0.4.0', dependencies: { example: '0.4.0' } })
  json('frontend/src/api/openapi.json', { info: { version: '0.4.0' } })
  write('backend/pyproject.toml', '[project]\nversion = "0.4.0"\n')
  write('backend/app/core/version.py', 'APP_VERSION: str = "0.4.0"\n')
  write('frontend/android/app/build.gradle', 'defaultConfig {\n    versionCode 4\n    versionName "0.4.0"\n}\n')
  return { root, write, json, read: (path: string) => readFileSync(join(root, path), 'utf8') }
}

test('synchronizes app metadata without changing dependency versions; Android bumps only once', (t) => {
  const project = fixture(t)
  syncVersion(project.root)
  const frontend = JSON.parse(project.read('frontend/package.json'))
  assert.equal(frontend.version, '0.5.0')
  assert.equal(frontend.dependencies.example, '0.4.0')
  for (const path of ['package-lock.json', 'frontend/package-lock.json']) {
    const lock = JSON.parse(project.read(path))
    assert.equal(lock.version, '0.5.0')
    assert.equal(lock.packages[''].version, '0.5.0')
    assert.equal(lock.packages.dependency.version, '0.4.0')
  }
  assert.match(project.read('backend/pyproject.toml'), /version = "0.5.0"/)
  assert.match(project.read('backend/app/core/version.py'), /APP_VERSION: str = "0.5.0"/)
  assert.match(project.read('frontend/android/app/build.gradle'), /versionCode 5/)
  assert.match(project.read('frontend/android/app/build.gradle'), /versionName "0.5.0"/)
  assert.deepEqual(syncVersion(project.root).changed, [])
  project.json('package.json', { version: '0.5.1' })
  syncVersion(project.root)
  assert.match(project.read('frontend/android/app/build.gradle'), /versionCode 6/)
})

test('check reports drift without writing and catches an unregenerated API schema', (t) => {
  const project = fixture(t)
  const before = project.read('frontend/package.json')
  assert.throws(() => syncVersion(project.root, { check: true }), /out of sync/)
  assert.equal(project.read('frontend/package.json'), before)
  syncVersion(project.root)
  assert.throws(() => syncVersion(project.root, { check: true }), /api:generate/)
  project.json('frontend/src/api/openapi.json', { info: { version: '0.5.0' } })
  assert.doesNotThrow(() => syncVersion(project.root, { check: true }))
  project.write('backend/app/core/version.py', 'APP_VERSION: str = "0.4.0"\n')
  assert.throws(() => syncVersion(project.root, { check: true }), /backend\/app\/core\/version.py/)
})

test('malformed metadata fails before updating any file', (t) => {
  const project = fixture(t)
  project.write('frontend/android/app/build.gradle', 'defaultConfig {}\n')
  assert.throws(() => syncVersion(project.root), /metadata is missing/)
  assert.equal(JSON.parse(project.read('frontend/package.json')).version, '0.4.0')
})

test('release tags must match the canonical version', (t) => {
  const project = fixture(t)
  assert.throws(() => syncVersion(project.root, { releaseTag: 'v0.4.0' }), /does not match/)
  assert.equal(JSON.parse(project.read('frontend/package.json')).version, '0.4.0')
  assert.doesNotThrow(() => syncVersion(project.root, { releaseTag: 'v0.5.0' }))
})

test('Windows checkout line endings do not cause false version drift', (t) => {
  const project = fixture(t)
  const path = 'frontend/package.json'
  project.write(path, project.read(path).replaceAll('\n', '\r\n'))
  syncVersion(project.root)
  assert.ok(project.read(path).includes('\r\n'))
  assert.deepEqual(syncVersion(project.root).changed, [])
  project.json('frontend/src/api/openapi.json', { info: { version: '0.5.0' } })
  assert.doesNotThrow(() => syncVersion(project.root, { check: true }))
})

test('a CRLF backend version file validates and retains its line endings after a bump', (t) => {
  const project = fixture(t)
  syncVersion(project.root)
  project.json('frontend/src/api/openapi.json', { info: { version: '0.5.0' } })
  const path = 'backend/app/core/version.py'
  const checkout = project.read(path).replaceAll('\n', '\r\n')
  project.write(path, checkout)

  assert.doesNotThrow(() => syncVersion(project.root, { check: true }))
  assert.deepEqual(syncVersion(project.root).changed, [])
  assert.equal(project.read(path), checkout)

  project.json('package.json', { version: '0.5.1' })
  assert.throws(() => syncVersion(project.root, { check: true }), /backend\/app\/core\/version.py/)
  syncVersion(project.root)
  const bumped = project.read(path)
  assert.match(bumped, /APP_VERSION: str = "0\.5\.1"\r\n/)
  assert.ok(!bumped.replaceAll('\r\n', '').includes('\n'))
  project.json('frontend/src/api/openapi.json', { info: { version: '0.5.1' } })
  assert.doesNotThrow(() => syncVersion(project.root, { check: true }))
})

test('prerelease app versions become valid Python package versions', (t) => {
  assert.equal(pythonVersion('0.5.0'), '0.5.0')
  assert.equal(pythonVersion('0.6.0-alpha.0'), '0.6.0a0')
  assert.equal(pythonVersion('0.6.0-beta.2'), '0.6.0b2')
  assert.equal(pythonVersion('0.6.0-rc.1'), '0.6.0rc1')
  for (const invalid of ['0.05.0', '0.5', '0.6.0-rc.01', '0.6.0-preview.1', '0.6.0+build']) {
    assert.throws(() => pythonVersion(invalid))
  }
  const project = fixture(t)
  project.json('package.json', { version: '0.6.0-rc.1' })
  syncVersion(project.root)
  assert.match(project.read('backend/pyproject.toml'), /version = "0.6.0rc1"/)
  assert.match(project.read('backend/app/core/version.py'), /APP_VERSION: str = "0.6.0-rc.1"/)
  assert.match(project.read('frontend/android/app/build.gradle'), /versionName "0.6.0-rc.1"/)
})
