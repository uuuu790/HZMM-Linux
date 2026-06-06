import { describe, it, expect } from 'vitest'
import { compareVersions } from '../../src/main/services/app-updater.js'

// ---------------------------------------------------------------------------
// Linux fork: the Windows-only exe-swap updater was removed. The IPC module
// (src/main/ipc/app-update.js) no longer exports `assertSafeBatchPath` or
// `generateUpdaterBatch` — Linux ships an AppImage/deb the user installs
// manually, so there is no batch script, no PORTABLE_EXECUTABLE_FILE, no
// download-and-swap. Those describe-blocks were deleted (the functions are
// gone by design) and replaced with tests of the updater logic that DOES
// exist on Linux: the semantic-version comparison that drives the
// "is there an update?" decision in checkForUpdate().
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// compareVersions(current, latest) -> boolean
//   Returns true when `latest` is strictly newer than `current`. This is the
//   single decision that determines whether the app reports an available
//   update. It is pure (no I/O), so it can be unit-tested directly.
// ---------------------------------------------------------------------------
describe('compareVersions — update-available decision', () => {
  it('reports an update when latest is a newer patch', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(true)
  })

  it('reports an update when latest is a newer minor', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(true)
  })

  it('reports an update when latest is a newer major', () => {
    expect(compareVersions('1.9.9', '2.0.0')).toBe(true)
  })

  it('reports NO update when versions are identical', () => {
    expect(compareVersions('1.3.7', '1.3.7')).toBe(false)
  })

  it('reports NO update when latest is older (downgrade)', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(false)
    expect(compareVersions('1.0.1', '1.0.0')).toBe(false)
  })

  it('strips a leading "v" on either side before comparing', () => {
    expect(compareVersions('v1.0.0', 'v1.0.1')).toBe(true)
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(false)
    expect(compareVersions('1.2.0', 'v1.2.0')).toBe(false)
  })

  it('compares numerically, not lexically (10 > 9)', () => {
    // A lexical/string compare would wrongly rank "1.0.9" above "1.0.10".
    expect(compareVersions('1.0.9', '1.0.10')).toBe(true)
    expect(compareVersions('1.0.10', '1.0.9')).toBe(false)
  })

  it('treats a missing trailing segment as 0 (1.2 === 1.2.0)', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(false)
    expect(compareVersions('1.2.0', '1.2')).toBe(false)
    expect(compareVersions('1.2', '1.2.1')).toBe(true)
  })

  it('ignores a pre-release suffix on the latest tag', () => {
    // `1.0.0-beta.1` strips to `1.0.0`, which is not newer than `1.0.0`.
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(false)
    // A pre-release of a genuinely newer version still counts as newer.
    expect(compareVersions('1.0.0', '1.1.0-rc.2')).toBe(true)
  })

  it('ignores a pre-release suffix on the current version', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(false)
    expect(compareVersions('1.0.0-beta.1', '1.0.1')).toBe(true)
  })

  it('is decisive at the first differing segment (does not over-read)', () => {
    // Major differs in current's favor, so later segments must not flip it.
    expect(compareVersions('2.0.0', '1.99.99')).toBe(false)
    expect(compareVersions('1.99.99', '2.0.0')).toBe(true)
  })
})
