import https from 'node:https'
import { decodeUtf8Chunks } from './nexus-v2-client.js'
import {
  STEAM_PAGE_SIZE, buildBrowseUrl, parseWorkshopIds, buildDetailsBody, mergeDetails,
} from './steam-workshop-util.js'

const REQUEST_TIMEOUT_MS = 12000
const UA = `HZMM/${process.env.npm_package_version || 'dev'}`
const DETAILS_ENDPOINT = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'

// Minimal HTTPS request returning the decoded body string. Reuses the
// Buffer.concat UTF-8 decode that fixed CJK chunk-boundary corruption.
function httpRequest(url, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': UA, ...headers },
    }
    if (body != null) opts.headers['Content-Length'] = Buffer.byteLength(body)
    const req = https.request(opts, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume() // drain the socket instead of buffering an error body
        reject(new Error(`Steam request failed: ${res.statusCode}`))
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(decodeUtf8Chunks(chunks)))
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Steam request timed out')) })
    if (body != null) req.write(body)
    req.end()
  })
}

// Browse one page: scrape IDs from the workshop HTML, then batch-hydrate full
// details via the keyless GetPublishedFileDetails endpoint.
export async function browseWorkshop({ sort = 'trend', page = 1, search = '' } = {}) {
  const html = await httpRequest(buildBrowseUrl({ sort, page, search }))
  const ids = parseWorkshopIds(html)
  if (ids.length === 0) return { ok: true, items: [], page, hasNext: false }

  const json = await httpRequest(DETAILS_ENDPOINT, {
    method: 'POST',
    body: buildDetailsBody(ids),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  let parsed
  try { parsed = JSON.parse(json) } catch { throw new Error('Steam details: bad JSON') }
  const items = mergeDetails(ids, parsed?.response?.publishedfiledetails || [])
  return { ok: true, items, page, hasNext: ids.length >= STEAM_PAGE_SIZE }
}
