import fs from 'fs'
import path from 'path'
import configStore from './config-store'

let LOG_FILE = ''
let OLD_LOG_FILE = ''
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const UTF8_BOM = '\uFEFF'

function ensureLogPaths(): void {
  if (!LOG_FILE) {
    LOG_FILE = path.join(configStore.getConfigDir(), 'hzmm.log')
    OLD_LOG_FILE = path.join(configStore.getConfigDir(), 'hzmm.log.old')
  }
}

function ensureDir(): void {
  ensureLogPaths()
  const dir = path.dirname(LOG_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function rotate(): void {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size >= MAX_SIZE) {
      if (fs.existsSync(OLD_LOG_FILE)) fs.unlinkSync(OLD_LOG_FILE)
      fs.renameSync(LOG_FILE, OLD_LOG_FILE)
    }
  } catch {
    // File doesn't exist yet, nothing to rotate
  }
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Create the log file seeded with the UTF-8 BOM exactly once, so external
// editors (Windows Notepad) decode CJK log lines correctly — regardless of
// whether write() or getPath() touches the file first.
function ensureFileWithBom(): void {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, UTF8_BOM, 'utf-8')
  }
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

function write(level: LogLevel, message: unknown): void {
  // Best-effort: a failed log write (disk full, locked file, drive detached)
  // must never propagate out of logger.info/warn/error — many call sites log as
  // the last step of an otherwise-successful op, and a throw here would turn
  // that success into a failure (or mask an in-flight error inside a catch).
  try {
    ensureDir()
    rotate()
    ensureFileWithBom()
    // Strip CR/LF so a mod name / error string can't forge extra log lines in
    // the in-app viewer (log-line injection).
    const safe = String(message).replace(/[\r\n]+/g, ' ')
    const line = `[${timestamp()}] [${level}] ${safe}\n`
    fs.appendFileSync(LOG_FILE, line, 'utf-8')
  } catch { /* logging is best-effort — never throw to the caller */ }
}

function readRecent(lineCount = 100): string[] {
  ensureLogPaths()
  if (!fs.existsSync(LOG_FILE)) return []
  let content = fs.readFileSync(LOG_FILE, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  const lines = content.split('\n').filter(Boolean)
  return lines.slice(-lineCount)
}

const logger = {
  info: (msg: unknown): void => write('INFO', msg),
  warn: (msg: unknown): void => write('WARN', msg),
  error: (msg: unknown): void => write('ERROR', msg),
  getPath: (): string => {
    ensureDir()
    ensureFileWithBom()
    return LOG_FILE
  },
  readRecent
}

export default logger
