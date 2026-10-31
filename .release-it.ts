import { readFileSync } from 'node:fs'
import type { Config } from 'release-it'
import type { Commit } from 'conventional-commits-parser'
import type { WhatBumpResult } from 'conventional-recommended-bump'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export function recommendBump(commits: Commit[], currentVersion: string): WhatBumpResult {
  const breaking = commits.some((commit) => commit.notes.length > 0)
  const feature = commits.some((commit) => commit.type === 'feat')
  const fix = commits.some((commit) => ['fix', 'perf'].includes(String(commit.type)))
  // Before 1.0, breaking changes advance the minor version. Reaching 1.0
  // remains an explicit release decision.
  const level = breaking
    ? (currentVersion.startsWith('0.') ? 1 : 0)
    : feature ? 1 : fix ? 2 : undefined
  return level === undefined ? null : { level, reason: 'Conventional Commits release policy' }
}

export default {
  git: {
    requireBranch: 'main',
    requireCleanWorkingDir: true,
    commitMessage: 'chore(release): v${version}',
    tagName: 'v${version}',
  },
  // Calculate bumps from the last published tag, including the initial 0.5.0
  // release already prepared in package.json. npm still updates the manifest.
  npm: { publish: false, ignoreVersion: true, allowSameVersion: true },
  // CI publishes the GitHub Release after the image and APK have succeeded.
  github: { release: false },
  plugins: {
    '@release-it/conventional-changelog': {
      preset: { name: 'conventionalcommits' },
      infile: 'CHANGELOG.md',
      whatBump: (commits: Commit[]) => recommendBump(commits, version),
    },
  },
  hooks: {
    'before:init': 'npm run version:check',
    'after:bump': [
      'npm run version:sync',
      'npm --prefix frontend run api:generate',
      'npm run version:check',
    ],
  },
} satisfies Config
