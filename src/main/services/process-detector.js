import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

const KNOWN_EXE_NAMES = [
  'HumanitZ-Win64-Shipping.exe',
  'HumanitZ.exe'
]

const VALID_EXE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/

// `pgrep -af <pattern>` returns rows like:
//   12345 wine64-preloader HumanitZ-Win64-Shipping.exe -fullscreen
// One matching row anywhere in the output is enough.
//
// Exported for unit testing — the real isGameRunning shells out to pgrep
// which can't be exercised cheaply outside Linux.
export function parsePgrepOutput(stdout, expectedExeName) {
  if (typeof stdout !== 'string' || !expectedExeName) return false
  const lines = stdout.trim().split(/\r?\n/)
  const needle = expectedExeName.toLowerCase()
  for (const line of lines) {
    if (line.toLowerCase().includes(needle)) return true
  }
  return false
}

async function isGameRunning(gameExePath) {
  const exeNames = [...KNOWN_EXE_NAMES]
  if (gameExePath) {
    const exeName = path.basename(gameExePath)
    if (!exeNames.includes(exeName)) {
      exeNames.unshift(exeName)
    }
  }

  for (const exeName of exeNames) {
    // Skip exe names with invalid characters to prevent command injection —
    // pgrep takes a regex pattern, so unescaped metacharacters would also
    // change the match semantics, not just risk injection.
    if (!VALID_EXE_NAME_PATTERN.test(exeName)) {
      continue
    }

    try {
      // -a includes the full command line so we match the .exe name that
      // Wine carries even though the kernel process is wine64-preloader.
      // -f matches against the full command line (default would be argv[0]).
      // pgrep exits 1 when nothing matches — catch handles that as "not running".
      const { stdout } = await execAsync(
        `pgrep -af ${exeName}`,
        { encoding: 'utf-8', timeout: 3000 }
      )
      if (parsePgrepOutput(stdout, exeName)) return true
    } catch {
      // Exit code 1 = no matches (normal); other errors also treated as
      // "not running" so a missing pgrep doesn't surface as a UI error.
      continue
    }
  }

  return false
}

export { isGameRunning }
