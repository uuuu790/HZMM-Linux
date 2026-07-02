// V2 returns camelCase, but the detail render code expects V1's snake_case.
// Adapt the detail payload once so the JSX stays flat.
export function adaptV2Mod(v2) {
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
