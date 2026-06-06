// Shared README content normalization for HZMM.
// Applied both at mod install time (when caching a PAK mod's readme into
// the config dir) and at read time (when feeding content to the renderer).

const MAX_README_CHARS = 5000

// Strip UTF-8 BOM from the start of the string if present.
// Notepad-saved files often include one, which breaks marked's first-heading
// detection downstream.
function stripBom(content) {
  if (typeof content !== 'string') return ''
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
}

// Truncate to MAX_README_CHARS units, stepping back one code unit if the
// cut would land on a high surrogate (otherwise the stored string ends
// with a lone surrogate that renders as U+FFFD).
function safeTruncate(content) {
  if (content.length <= MAX_README_CHARS) return content
  let end = MAX_README_CHARS
  const code = content.charCodeAt(end - 1)
  if (code >= 0xD800 && code <= 0xDBFF) end -= 1
  return content.slice(0, end)
}

// Convert a raw buffer (UTF-8) or string into a renderer-safe, storage-safe
// readme. Strips BOM, truncates to 5000 units without breaking surrogate
// pairs. Returns empty string on bad input.
export function normalizeReadme(input) {
  if (input == null) return ''
  const raw = typeof input === 'string' ? input : input.toString('utf-8')
  return safeTruncate(stripBom(raw))
}

export { MAX_README_CHARS, stripBom, safeTruncate }
