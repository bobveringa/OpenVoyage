import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptRoot, '..')
const apkPath = join(
  frontendRoot,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
)

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: frontendRoot,
    stdio: 'inherit',
  })

  if (result.error) {
    fail(result.error.message)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function parseArguments(argumentsToParse) {
  let build = false
  let device = null

  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index]

    if (argument === '--build') {
      build = true
      continue
    }
    if (argument === '--device' || argument === '-s') {
      device = argumentsToParse[index + 1]
      if (!device || device.startsWith('-')) {
        fail(`${argument} requires an adb device serial.`)
      }
      index += 1
      continue
    }

    fail(`Unknown argument: ${argument}. Use --device <serial> or --build.`)
  }

  return { build, device }
}

const { build, device } = parseArguments(process.argv.slice(2))

if (build) {
  // npm is a .cmd shim on Windows. Run it through cmd.exe, as Node cannot
  // spawn a batch file directly in this environment.
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'run', 'android:apk'])
  } else {
    run('npm', ['run', 'android:apk'])
  }
}

if (!existsSync(apkPath)) {
  fail('Debug APK not found. Run "npm run android:apk" first, or use "npm run android:deploy".')
}

const adbArguments = [
  ...(device ? ['-s', device] : []),
  'install',
  '-r',
  apkPath,
]

console.log(`> Installing ${apkPath}${device ? ` on ${device}` : ''}`)
run('adb', adbArguments)
