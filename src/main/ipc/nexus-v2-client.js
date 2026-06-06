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

import https from 'https'

export const GAME_DOMAIN = 'humanitz'
export const GAME_ID = 5743

const DEFAULT_BROWSE_COUNT = 100
const REQUEST_TIMEOUT_MS = 10000

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

// Map HZMM's UI sort option to a V2 ModsSort input.
// Valid sort keys (probed from schema): relevance, name, downloads,
// uniqueDownloads, endorsements, random, createdAt, updatedAt, size, lastComment.
export const SORT_MAP = {
  trending: { endorsements: { direction: 'DESC' } },
  latest_updated: { updatedAt: { direction: 'DESC' } },
  latest_added: { createdAt: { direction: 'DESC' } },
  most_downloaded: { downloads: { direction: 'DESC' } },
  relevance: { relevance: { direction: 'DESC' } },
}

function gqlRequest(query, variables) {
  const body = JSON.stringify({ query, variables })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.nexusmods.com',
      path: '/v2/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `HZMM/${process.env.npm_package_version || 'dev'}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`V2 HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
        }
        try {
          const parsed = JSON.parse(data)
          if (parsed.errors) {
            return reject(new Error(`V2 GraphQL: ${parsed.errors[0]?.message || 'unknown'}`))
          }
          resolve(parsed.data)
        } catch (e) {
          reject(new Error(`V2 parse error: ${e.message}`))
        }
      })
    })
    req.on('error', reject)
    // Abort if Nexus accepts the TCP connection but never responds. Without
    // this, the UI spinner spins indefinitely (no error path) on a hung API.
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('Nexus V2 GraphQL request timed out'))
    })
    req.write(body)
    req.end()
  })
}

export async function v2ListMods({ sort, count = DEFAULT_BROWSE_COUNT, offset = 0 }) {
  const sortInput = SORT_MAP[sort] || SORT_MAP.trending
  const data = await gqlRequest(
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

export async function v2SearchMods({ keyword, count = DEFAULT_BROWSE_COUNT }) {
  // nameStemmed does fuzzy / stemmed substring match across the catalogue.
  // Relevance sort is the natural ordering for keyword results.
  const data = await gqlRequest(
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

export async function v2GetMod(modId) {
  const data = await gqlRequest(
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

export async function v2GetModFiles(modId) {
  const data = await gqlRequest(
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
