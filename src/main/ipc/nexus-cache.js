// Tiny in-memory TTL cache used by the Nexus IPC handlers.
// Nexus's V2 GraphQL is generous with rate limits, but we still dedupe
// back-to-back identical requests (e.g. switching between sort tabs
// re-triggers list-mods; rapid keyword typing spawns a search per keystroke
// if we forget to debounce).
//
// CACHE_VERSION prefixes every key so that whenever a query's selected
// fields change, bumping the version invalidates old entries in one step
// and we don't hand the renderer a stale shape across a dev HMR cycle.
//
// Split out of nexus.js as part of the 470-line refactor.

export const CACHE_VERSION = 'v2'

export const CACHE_TTL = {
  list: 60 * 60 * 1000,
  detail: 60 * 60 * 1000,
  files: 30 * 60 * 1000,
  validate: 5 * 60 * 1000,
  // Search results expire fast — users iterate on queries quickly.
  search: 2 * 60 * 1000,
}

// Bound entries so a long session of rapid search typing (each keystroke is
// a new key) can't grow the Map unbounded. Map preserves insertion order so
// deleting the head approximates LRU well enough for this dedupe cache.
export const MAX_ENTRIES = 200

const cache = new Map()

function cacheKey(key) { return `${CACHE_VERSION}:${key}` }

export function cacheGet(key) {
  const k = cacheKey(key)
  const hit = cache.get(k)
  if (!hit) return null
  if (Date.now() > hit.expires) { cache.delete(k); return null }
  return hit.data
}

export function cacheSet(key, data, ttl) {
  const k = cacheKey(key)
  if (!cache.has(k) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(k, { data, expires: Date.now() + ttl })
}

export function cacheClear(prefix) {
  if (!prefix) { cache.clear(); return }
  const versioned = cacheKey(prefix)
  for (const key of cache.keys()) if (key.startsWith(versioned)) cache.delete(key)
}
