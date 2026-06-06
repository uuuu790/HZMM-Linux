import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// 只偵測 shipping 進程作為「遊戲是否運行中」的依據。根目錄 HumanitZ.exe 是
// ~190KB 的 launcher/bootstrap，生命週期綁在 shipping 上、在異常結束時可能殘留；
// 真正代表遊戲在玩的是 Binaries/Win64 的 shipping 進程，退出遊戲時必定結束。
// 在 Proton 下這顆 .exe 由 wine64-preloader 載入，仍以這個名字出現在命令列。
export const GAME_PROCESS_NAMES = [
  'HumanitZ-Win64-Shipping.exe'
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

async function isGameRunning() {
  for (const exeName of GAME_PROCESS_NAMES) {
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
