/** The Nexus V2 (GraphQL, camelCase) mod fields the detail view adapts. */
export interface NexusV2Mod {
  modId?: number
  pictureUrl?: string | null
  thumbnailLargeUrl?: string | null
  thumbnailUrl?: string | null
  downloads?: number
  endorsements?: number
  updatedAt?: string
  author?: string | null
  uploader?: { name?: string | null } | null
  adultContent?: boolean
}

/** The V1 (snake_case) fields the detail render code reads. */
export interface NexusV1DetailFields {
  mod_id: number | undefined
  picture_url: string | null | undefined
  mod_downloads: number | undefined
  mod_unique_downloads: number | undefined
  endorsement_count: number | undefined
  updated_timestamp: string | undefined
  uploaded_by: string | null | undefined
  author: string | null | undefined
  contains_adult_content: boolean | undefined
}

// V2 returns camelCase, but the detail render code expects V1's snake_case.
// Adapt the detail payload once so the JSX stays flat.
export function adaptV2Mod<T extends NexusV2Mod>(v2: T | null | undefined): (T & NexusV1DetailFields) | null {
  if (!v2) return null
  return {
    ...v2,
    mod_id: v2.modId,
    // Full-resolution picture first — the banner stretches this wide, so a
    // thumbnail here renders blurry. Fall back to thumbnails only when absent.
    picture_url: v2.pictureUrl || v2.thumbnailLargeUrl || v2.thumbnailUrl,
    mod_downloads: v2.downloads,
    mod_unique_downloads: v2.downloads,
    endorsement_count: v2.endorsements,
    updated_timestamp: v2.updatedAt,
    uploaded_by: v2.uploader?.name || v2.author,
    author: v2.author || v2.uploader?.name,
    contains_adult_content: v2.adultContent,
  }
}
