// Nexus Mods V2 GraphQL client — unauthenticated, public-read only.
// Covers everything V2 exposes that we care about: mod list with sort +
// filter, keyword search (stemmed), mod detail, mod files. The V1 install
// endpoints (`download_link.json`, account validate) live elsewhere because
// they require an API key and have a different lifecycle.
//
// Game targeting: HumanitZ. gameId 5743 was probed via V2's
// `game(domainName: "humanitz")` and cached as a constant to skip a round
// trip per query.
//
// Split out of nexus.js as part of the 470-line refactor.

import { netRequest } from '../services/net-client'
import type { NexusModFile, V2ModDetail, V2ModsPage } from './types'

export const GAME_DOMAIN = 'humanitz'
export const GAME_ID = 5743

const DEFAULT_BROWSE_COUNT = 100
const REQUEST_TIMEOUT_MS = 10000

// Concatenate raw response chunks THEN decode once. Decoding each chunk
// independently (the old `data += chunk` form) mangles any multi-byte UTF-8
// character that straddles a TCP chunk boundary into U+FFFD.
// (netRequest does this internally now; kept exported for its regression test.)
export function decodeUtf8Chunks(chunks: readonly Uint8Array[]): string {
  return Buffer.concat(chunks).toString('utf8')
}

// Shared fragment used everywhere we return a mod card.
const MOD_CARD_FIELDS = `
  modId
  name
  summary
  author
  version
  pictureUrl
  thumbnailUrl
  endorsements
  downloads
  adultContent
  updatedAt
  createdAt
  modCategory { name }
`

type SortDirection = 'ASC' | 'DESC'

// Map HZMM's UI sort option to a V2 ModsSort input.
// Valid sort keys (probed from schema): relevance, name, downloads,
// uniqueDownloads, endorsements, random, createdAt, updatedAt, size, lastComment.
export const SORT_MAP: Record<string, Record<string, { direction: SortDirection }>> = {
  trending: { endorsements: { direction: 'DESC' } },
  latest_updated: { updatedAt: { direction: 'DESC' } },
  latest_added: { createdAt: { direction: 'DESC' } },
  most_downloaded: { downloads: { direction: 'DESC' } },
  relevance: { relevance: { direction: 'DESC' } },
}

/** A V2 `modFiles` entry as GraphQL sends it (before normalization). */
interface V2ModFileRaw {
  fileId: number
  name: string
  version: string
  description: string | null
  categoryId: number
  category: string
  primary: boolean | number | null
  size: number
  /** GraphQL BigInt — arrives as a string. */
  sizeInBytes: string | number
  date: string
  uri: string
  totalDownloads: number
  uniqueDownloads: number
}

interface GraphqlResponse<T> {
  data: T
  errors?: Array<{ message?: string }>
}

// netRequest rides Electron's net module (Chromium stack) so it follows the
// OS proxy settings — same reason downloadFile does. The hard deadline keeps
// the old "hung API never spins the UI forever" guarantee.
// `T` is the shape the query selects; the response is trusted to match it.
async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await netRequest('https://api.nexusmods.com/v2/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `HZMM/${process.env.npm_package_version || 'dev'}`,
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'Nexus V2 GraphQL request timed out',
  })
  const data: string = res.bodyText
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`V2 HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
  }
  let parsed: GraphqlResponse<T>
  try {
    parsed = JSON.parse(data)
  } catch (e) {
    throw new Error(`V2 parse error: ${(e as Error).message}`)
  }
  if (parsed.errors) {
    throw new Error(`V2 GraphQL: ${parsed.errors[0]?.message || 'unknown'}`)
  }
  return parsed.data
}

export async function v2ListMods({ sort, count = DEFAULT_BROWSE_COUNT, offset = 0 }: { sort?: string; count?: number; offset?: number }): Promise<V2ModsPage> {
  const sortInput = (sort && SORT_MAP[sort]) || SORT_MAP.trending
  const data = await gqlRequest<{ mods: V2ModsPage }>(
    `query ListMods($filter: ModsFilter, $sort: [ModsSort!], $count: Int, $offset: Int) {
      mods(filter: $filter, sort: $sort, count: $count, offset: $offset) {
        totalCount
        nodes { ${MOD_CARD_FIELDS} }
      }
    }`,
    {
      filter: { gameDomainName: { value: GAME_DOMAIN } },
      sort: [sortInput],
      count,
      offset,
    }
  )
  return data.mods
}

export async function v2SearchMods({ keyword, count = DEFAULT_BROWSE_COUNT }: { keyword: string; count?: number }): Promise<V2ModsPage> {
  // nameStemmed does fuzzy / stemmed substring match across the catalogue.
  // Relevance sort is the natural ordering for keyword results.
  const data = await gqlRequest<{ mods: V2ModsPage }>(
    `query SearchMods($filter: ModsFilter, $sort: [ModsSort!], $count: Int) {
      mods(filter: $filter, sort: $sort, count: $count) {
        totalCount
        nodes { ${MOD_CARD_FIELDS} }
      }
    }`,
    {
      filter: {
        gameDomainName: { value: GAME_DOMAIN },
        nameStemmed: { value: keyword },
      },
      sort: [SORT_MAP.relevance],
      count,
    }
  )
  return data.mods
}

export async function v2GetMod(modId: number | string): Promise<V2ModDetail | null> {
  const data = await gqlRequest<{ mod: V2ModDetail | null }>(
    `query ModDetail($modId: ID!, $gameId: ID!) {
      mod(modId: $modId, gameId: $gameId) {
        modId
        name
        summary
        description
        author
        version
        pictureUrl
        thumbnailUrl
        thumbnailLargeUrl
        endorsements
        downloads
        fileSize
        adultContent
        updatedAt
        createdAt
        modCategory { name }
        uploader { name memberId }
      }
    }`,
    { modId, gameId: GAME_ID }
  )
  return data.mod
}

export async function v2GetModFiles(modId: number | string): Promise<NexusModFile[]> {
  const data = await gqlRequest<{ modFiles: V2ModFileRaw[] | null }>(
    `query ModFiles($modId: ID!, $gameId: ID!) {
      modFiles(modId: $modId, gameId: $gameId) {
        fileId
        name
        version
        description
        categoryId
        category
        primary
        size
        sizeInBytes
        date
        uri
        totalDownloads
        uniqueDownloads
      }
    }`,
    { modId, gameId: GAME_ID }
  )
  // Normalize to the snake_case shape the renderer already expects.
  return (data.modFiles || []).map(f => ({
    file_id: f.fileId,
    name: f.name,
    version: f.version,
    description: f.description,
    category_id: f.categoryId,
    category_name: f.category,
    is_primary: !!f.primary,
    size: f.size,                          // KB, matches V1
    size_in_bytes: Number(f.sizeInBytes),  // GraphQL BigInt arrives as string
    uploaded_timestamp: f.date,
    file_name: f.uri,
    total_downloads: f.totalDownloads,
    unique_downloads: f.uniqueDownloads,
  }))
}
