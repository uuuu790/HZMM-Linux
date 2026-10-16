import { netRequest } from '../services/net-client'
import {
  STEAM_PAGE_SIZE, buildBrowseUrl, parseWorkshopIds, buildDetailsBody, mergeDetails,
} from './steam-workshop-util'
import type { SteamPublishedFileDetails, WorkshopBrowseOptions, WorkshopBrowseResult } from './types'

const REQUEST_TIMEOUT_MS = 12000
const UA = `HZMM/${process.env.npm_package_version || 'dev'}`
const DETAILS_ENDPOINT = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'

interface HttpOptions {
  method?: string
  body?: string | null
  headers?: Record<string, string>
}

// Minimal HTTPS request returning the decoded body string. Goes through
// Electron's net module (netRequest) so it follows the OS proxy settings and
// keeps the Buffer.concat UTF-8 decode that fixed CJK chunk-boundary
// corruption.
async function httpRequest(url: string, { method = 'GET', body = null, headers = {} }: HttpOptions = {}): Promise<string> {
  const res = await netRequest(url, {
    method,
    body,
    headers: { 'User-Agent': UA, ...headers },
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'Steam request timed out',
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Steam request failed: ${res.statusCode}`)
  }
  return res.bodyText
}

// Browse one page: scrape IDs from the workshop HTML, then batch-hydrate full
// details via the keyless GetPublishedFileDetails endpoint.
export async function browseWorkshop({ sort = 'trend', page = 1, search = '' }: WorkshopBrowseOptions = {}): Promise<WorkshopBrowseResult> {
  const html = await httpRequest(buildBrowseUrl({ sort, page, search }))
  const ids = parseWorkshopIds(html)
  if (ids.length === 0) return { ok: true, items: [], page, hasNext: false }

  const json = await httpRequest(DETAILS_ENDPOINT, {
    method: 'POST',
    body: buildDetailsBody(ids),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  let parsed: { response?: { publishedfiledetails?: SteamPublishedFileDetails[] } } | undefined
  try { parsed = JSON.parse(json) } catch { throw new Error('Steam details: bad JSON') }
  const items = mergeDetails(ids, parsed?.response?.publishedfiledetails || [])
  return { ok: true, items, page, hasNext: ids.length >= STEAM_PAGE_SIZE }
}
