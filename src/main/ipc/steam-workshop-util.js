// Pure, network-free helpers for the dev-only Steam Workshop browser.
// Unit-tested in tests/ipc/steam-workshop-util.test.js. No electron imports.

export const STEAM_WORKSHOP_APP_ID = 1281930 // tModLoader — test target; swap for HumanitZ later.
export const STEAM_PAGE_SIZE = 30 // Steam workshop browse default page size.

// UI sort -> Steam browse query. `trend` needs a day window.
const SORT_MAP = {
  trend: { browsesort: 'trend', days: 7 },
  toprated: { browsesort: 'toprated' },
  mostrecent: { browsesort: 'mostrecent' },
}

export function buildBrowseUrl({ appId = STEAM_WORKSHOP_APP_ID, sort = 'trend', page = 1, search = '' } = {}) {
  const cfg = SORT_MAP[sort] || SORT_MAP.trend
  const params = new URLSearchParams({
    appid: String(appId),
    browsesort: cfg.browsesort,
    actualsort: cfg.browsesort,
    p: String(page),
  })
  if (cfg.days) params.set('days', String(cfg.days))
  if (search) params.set('searchtext', search)
  return `https://steamcommunity.com/workshop/browse/?${params.toString()}`
}

// Extract ordered, unique published-file IDs from browse-page HTML.
export function parseWorkshopIds(html) {
  if (!html) return []
  const re = /filedetails\/\?id=(\d+)/g
  const seen = new Set()
  const ids = []
  let m
  while ((m = re.exec(html)) !== null) {
    const id = m[1]
    if (!seen.has(id)) { seen.add(id); ids.push(id) }
  }
  return ids
}

// Form-encoded POST body for GetPublishedFileDetails.
export function buildDetailsBody(ids) {
  const params = new URLSearchParams()
  params.set('itemcount', String(ids.length))
  ids.forEach((id, i) => params.set(`publishedfileids[${i}]`, String(id)))
  return params.toString()
}

// Normalize one GetPublishedFileDetails entry to the renderer's display shape.
// Returns null for entries that aren't usable (result !== 1 -> deleted/hidden).
export function adaptWorkshopItem(raw) {
  if (!raw || raw.result !== 1) return null
  const id = String(raw.publishedfileid)
  return {
    id,
    title: raw.title || '',
    previewUrl: raw.preview_url || '',
    subscriptions: Number(raw.subscriptions) || 0,
    favorited: Number(raw.favorited) || 0,
    views: Number(raw.views) || 0,
    fileSize: Number(raw.file_size) || 0,
    timeUpdated: Number(raw.time_updated) || 0,
    timeCreated: Number(raw.time_created) || 0,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tg) => tg.tag).filter(Boolean) : [],
    descriptionBBCode: raw.description || '',
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
  }
}

// Re-order detail entries to match the browse order, adapt, drop nulls.
export function mergeDetails(ids, details) {
  const byId = new Map((details || []).map((d) => [String(d.publishedfileid), d]))
  return ids.map((id) => adaptWorkshopItem(byId.get(id))).filter(Boolean)
}
