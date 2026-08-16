import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptRoot, '..')
const androidRoot = resolve(frontendRoot, 'android')

// Gradle 8.14.x (this project's wrapper version) fails to run at all on very
// new JDKs (JDK 25 errors with "Unsupported class file major version 69")
// and Capacitor/AGP need at least JDK 17, so a compatible JDK is anywhere in
// this range.
const MIN_COMPATIBLE_JDK = 17
const MAX_COMPATIBLE_JDK = 24

function javaExecutableName() {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

function isUsableJdk(jdkHome) {
  return existsSync(join(jdkHome, 'bin', javaExecutableName()))
}

// IntelliJ-family IDEs (including Android Studio) download JDKs a user picks
// into ~/.jdks, named like "corretto-24.0.2" or "openjdk-25.0.2". This picks
// the highest one in the compatible range without hardcoding a path tied to
// one machine/username.
function findJdkInHomeDir() {
  const jdksDir = join(homedir(), '.jdks')
  if (!existsSync(jdksDir)) {
    return null
  }

  const candidates = readdirSync(jdksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const match = /(\d+)(?:\.\d+)*$/.exec(entry.name)
      return match ? { path: join(jdksDir, entry.name), version: Number(match[1]) } : null
    })
    .filter(
      (candidate) =>
        candidate !== null &&
        candidate.version >= MIN_COMPATIBLE_JDK &&
        candidate.version <= MAX_COMPATIBLE_JDK,
    )
    .sort((a, b) => b.version - a.version)

  return candidates[0]?.path ?? null
}

function findCompatibleJavaHome() {
  if (process.env.JAVA_HOME && isUsableJdk(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME
  }
  return findJdkInHomeDir()
}

function main() {
  const javaHome = findCompatibleJavaHome()
  if (!javaHome) {
    console.error(
      `Could not find a JDK ${MIN_COMPATIBLE_JDK}-${MAX_COMPATIBLE_JDK} to build with.\n` +
        'Install one (e.g. via Android Studio > Settings > Build Tools > ' +
        'Gradle > Gradle JDK > Download JDK) and either set JAVA_HOME to it ' +
        'or let it land under ~/.jdks, which this script scans automatically.',
    )
    process.exit(1)
  }

  console.log(`> Building Android debug APK (JAVA_HOME=${javaHome})`)
  const isWindows = process.platform === 'win32'
  const gradlew = join(androidRoot, isWindows ? 'gradlew.bat' : 'gradlew')
  // Windows can't exec a .bat directly; run it through cmd.exe explicitly
  // rather than spawnSync's shell:true, which shell-concatenates args
  // instead of passing them as a real argv array.
  const command = isWindows ? 'cmd.exe' : gradlew
  const args = isWindows ? ['/d', '/s', '/c', gradlew, 'assembleDebug'] : ['assembleDebug']
  const result = spawnSync(command, args, {
    cwd: androidRoot,
    env: { ...process.env, JAVA_HOME: javaHome },
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  console.log(
    '\n> APK: android/app/build/outputs/apk/debug/app-debug.apk',
  )
}

main()
