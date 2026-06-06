import path from 'path'

// Reject any name that is not a flat single path segment. Used at the
// top of IPC handlers that take a mod filename / folder name from the
// renderer before passing it to fs APIs. Intentionally stricter than
// resolveWithin — mod names should never legitimately contain
// separators, ".." segments, or drive letters.
export function assertSafeSegment(label, name) {
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
export function isPathWithin(parent, candidate) {
  if (typeof parent !== 'string' || typeof candidate !== 'string') return false
  if (!parent || !candidate) return false

  const resolvedParent = path.resolve(parent)
  const resolvedCandidate = path.resolve(candidate)

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
export function resolveWithin(parent, ...segments) {
  if (typeof parent !== 'string' || !parent) {
    throw new Error('resolveWithin: parent must be a non-empty string')
  }
  for (const seg of segments) {
    if (typeof seg !== 'string') {
      throw new Error('resolveWithin: all segments must be strings')
    }
  }

  const joined = path.join(parent, ...segments)
  const resolved = path.resolve(joined)

  if (!isPathWithin(parent, resolved)) {
    throw new Error(`Path traversal blocked: ${segments.join('/')} escapes ${parent}`)
  }

  return resolved
}
