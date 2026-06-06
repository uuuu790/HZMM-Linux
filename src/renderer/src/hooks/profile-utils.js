// Pure helpers for profile filename matching.
//
// Background: PAK mods change their on-disk filename when toggled —
// `mymod.pak` (enabled) vs `mymod.pak.disabled` (disabled). A profile
// saves `enabledModFilenames` from the currently enabled state, so it
// always stores the base `.pak` form. When applying a profile against
// mods that are currently disabled, raw string comparison against
// `mod.filename` misses them and the PAK never gets re-enabled.
//
// UE4SS mods are unaffected — their filename is the folder name, which
// does not change between states — but it's still safe to normalize.

export function normalizeFilename(filename) {
  if (typeof filename !== 'string') return ''
  return filename.replace(/\.disabled$/i, '')
}

// Build a fast lookup set of normalized profile filenames.
export function normalizeProfileFilenames(enabledModFilenames) {
  if (!Array.isArray(enabledModFilenames)) return new Set()
  return new Set(enabledModFilenames.map(normalizeFilename).filter(Boolean))
}

// Does `mod` belong in the enabled set described by `profileSet`?
// `profileSet` should come from normalizeProfileFilenames().
export function modIsInProfile(profileSet, mod) {
  if (!profileSet || !mod || typeof mod.filename !== 'string') return false
  return profileSet.has(normalizeFilename(mod.filename))
}
