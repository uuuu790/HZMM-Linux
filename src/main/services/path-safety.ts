import path from 'path'

// Extensions whose OS default association EXECUTES the file rather than opening
// it for viewing. shell.openPath on any of these runs a payload, so any IPC
// "open this file" handler must reveal them in the folder instead. A malicious
// mod can drop such a file anywhere under the game directory, so this is the
// single source of truth shared by every openPath handler.
export const EXECUTABLE_EXTS: ReadonlySet<string> = new Set([
  '.exe', '.bat', '.cmd', '.com', '.ps1', '.psm1', '.msi', '.lnk', '.scr',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.jar', '.cpl',
  '.reg', '.inf', '.sct', '.application',
  // Shell-active types that ShellExecute treats as executable/active content.
  // .url/.scf can force outbound SMB auth via IconFile= (NTLM-hash theft,
  // CVE-2018-8495 class); .settingcontent-ms was an RCE vector; .chm/.hlp run
  // compiled help scripts; .appref-ms/.jnlp fetch+launch remote apps.
  '.url', '.website', '.scf', '.pif', '.msc', '.appref-ms', '.jnlp',
  '.chm', '.hlp', '.settingcontent-ms', '.gadget', '.mad', '.vsw',
  // Linux equivalents — this fork RUNS on Linux, where xdg-open dispatches
  // by extension/association too: .desktop files execute their Exec= line on
  // several DEs, and .sh/.run/.appimage are directly executable payloads.
  '.desktop', '.sh', '.run', '.appimage'
])

export function isExecutableExt(filePath: string): boolean {
  return EXECUTABLE_EXTS.has(path.extname(filePath).toLowerCase())
}

// Reject any name that is not a flat single path segment. Used at the
// top of IPC handlers that take a mod filename / folder name from the
// renderer before passing it to fs APIs. Intentionally stricter than
// resolveWithin — mod names should never legitimately contain
// separators, ".." segments, or drive letters.
export function assertSafeSegment(label: string, name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name) {
    throw new Error(`${label}: must be a non-empty string`)
  }
  if (name === '.' || name === '..') {
    throw new Error(`${label}: reserved name "${name}"`)
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`${label}: must not contain path separators`)
  }
  if (name.includes('..')) {
    // Blocks names like "foo..bar" containing .. anywhere — paranoid but
    // cheap. If a real mod name ever needs this we can relax later.
    throw new Error(`${label}: must not contain ".."`)
  }
  if (/[\0<>:"|?*]/.test(name)) {
    // Windows-reserved characters + null byte. Nexus / UE4SS mod names
    // never use these, and any of them appearing signals renderer tampering.
    throw new Error(`${label}: contains reserved characters`)
  }
  if (path.isAbsolute(name)) {
    throw new Error(`${label}: must not be an absolute path`)
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) {
    // Windows reserved device names resolve to the device, not a file.
    throw new Error(`${label}: reserved device name`)
  }
  if (/[. ]$/.test(name)) {
    // Trailing dot/space is silently stripped by Windows → name mismatch.
    throw new Error(`${label}: must not end with a dot or space`)
  }
}

// Check whether `candidate` resolves to a location inside `parent`.
// Handles: trailing separators, mixed separators on Windows,
// symlink-like `..` escapes, and the candidate === parent boundary case.
export function isPathWithin(parent: unknown, candidate: unknown): boolean {
  if (typeof parent !== 'string' || typeof candidate !== 'string') return false
  if (!parent || !candidate) return false

  // Archives always come from Windows tooling, so `\` must be treated as a path
  // separator on every platform. On POSIX path.resolve treats `\` as an ordinary
  // filename character, which would let a Windows-style ..\..\ candidate sneak
  // past this check; normalize to `/` first so path.resolve sees the real
  // structure (path.resolve already accepts `/` on Windows).
  const resolvedParent = path.resolve(parent.replace(/\\/g, '/'))
  const resolvedCandidate = path.resolve(candidate.replace(/\\/g, '/'))

  if (resolvedCandidate === resolvedParent) return true

  const parentWithSep = resolvedParent.endsWith(path.sep)
    ? resolvedParent
    : resolvedParent + path.sep

  return resolvedCandidate.startsWith(parentWithSep)
}

// Join segments under `parent` and return the absolute path only if the
// result stays inside `parent`. Otherwise throw. Use this instead of
// path.join + manual validation everywhere a renderer-supplied name or
// relative path is used to build a filesystem target.
export function resolveWithin(parent: unknown, ...segments: unknown[]): string {
  if (typeof parent !== 'string' || !parent) {
    throw new Error('resolveWithin: parent must be a non-empty string')
  }
  for (const seg of segments) {
    if (typeof seg !== 'string') {
      throw new Error('resolveWithin: all segments must be strings')
    }
  }

  // Normalize `\`→`/` in each segment before joining: Windows tooling produces
  // backslash separators, but on POSIX path.join treats `\` as a filename char,
  // so a `..\..\` segment would join as a harmless-looking single name and slip
  // past the traversal check below. `/` is a valid separator for path.join on
  // every platform, and path.join still neutralizes later absolute segments.
  const normalizedSegments = (segments as string[]).map(seg => seg.replace(/\\/g, '/'))
  const joined = path.join(parent, ...normalizedSegments)
  const resolved = path.resolve(joined)

  if (!isPathWithin(parent, resolved)) {
    throw new Error(`Path traversal blocked: ${segments.join('/')} escapes ${parent}`)
  }

  return resolved
}
