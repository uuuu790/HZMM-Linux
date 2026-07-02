import { describe, it, expect } from 'vitest'
import { adaptV2Mod } from '../../src/renderer/src/utils/nexus-mod-adapt.js'

describe('adaptV2Mod', () => {
  it('prefers full-resolution pictureUrl over thumbnails', () => {
    const out = adaptV2Mod({
      modId: 7, pictureUrl: 'full.jpg',
      thumbnailLargeUrl: 'thumbL.jpg', thumbnailUrl: 'thumbS.jpg',
    })
    expect(out.picture_url).toBe('full.jpg')
  })
  it('falls back to thumbnails when pictureUrl is absent', () => {
    expect(adaptV2Mod({ modId: 7, thumbnailLargeUrl: 'thumbL.jpg' }).picture_url).toBe('thumbL.jpg')
    expect(adaptV2Mod({ modId: 7, thumbnailUrl: 'thumbS.jpg' }).picture_url).toBe('thumbS.jpg')
  })
  it('maps V2 camelCase to the render snake_case shape', () => {
    const out = adaptV2Mod({ modId: 7, downloads: 10, endorsements: 3, updatedAt: 't', author: 'A' })
    expect(out.mod_id).toBe(7)
    expect(out.mod_downloads).toBe(10)
    expect(out.endorsement_count).toBe(3)
  })
  it('returns null for null input', () => {
    expect(adaptV2Mod(null)).toBeNull()
  })
})
