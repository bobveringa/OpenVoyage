import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bumper } from 'conventional-recommended-bump'
import createPreset from 'conventional-changelog-conventionalcommits'
import { CommitParser, type ParserOptions } from 'conventional-commits-parser'
import { recommendBump } from '../.release-it.ts'

const preset = await createPreset() as { parser: ParserOptions }
const parse = (message: string) => new CommitParser(preset.parser).parse(message)

const cases: Array<[string, string[], 'major' | 'minor' | 'patch' | undefined]> = [
  ['0.5.0', ['fix(tracking): correct synchronization'], 'patch'],
  ['0.5.0', ['perf: speed up uploads'], 'patch'],
  ['0.5.0', ['fix: correct GPS', 'feat: add version checks'], 'minor'],
  ['0.5.0', ['feat(api)!: change authentication'], 'minor'],
  ['0.5.0', ['chore: change config\n\nBREAKING CHANGE: use the new option'], 'minor'],
  ['1.5.0', ['feat(api)!: change authentication'], 'major'],
  ['1.5.0', ['feat: add version checks'], 'minor'],
  ['0.5.0', ['chore(deps): update dependencies', 'docs: update readme'], undefined],
]

for (const [version, messages, expected] of cases) {
  test(`${version}: ${messages.join('; ')} recommends ${expected ?? 'no release'}`, async () => {
    // Exercise the actual parser and bumper contract, including ! and footer
    // parsing, rather than testing only hand-built commit objects.
    const result = await new Bumper().commits(messages.map(parse)).bump(
      (commits) => recommendBump(commits, version),
    )
    assert.equal('releaseType' in result ? result.releaseType : undefined, expected)
  })
}
