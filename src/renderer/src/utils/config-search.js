// Search/filter helpers for the schema-driven config editor.
//
// Search is intentionally generous — it joins all human-readable surface for
// each key (keyName, sectionId, section label, key label, key description) and
// matches every space-separated term as a substring (AND logic). This lets a
// user type "AK47 damage" to land on BP_AK47Rifle.Damage even when the schema
// puts the weapon name in the section ID and the attribute name in the key
// label.

import { resolveI18n } from './config-parser';

// Build a (keyName, keyDef, sectionId, sectionLabel) → boolean matcher.
// Empty / whitespace-only query returns a matcher that accepts everything,
// so callers don't need a separate "no search" branch.
export function buildKeyMatcher(searchQuery, lang) {
  const terms = String(searchQuery || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return () => true;
  return (keyName, keyDef, sectionId, sectionLabel) => {
    const haystack = [
      keyName,
      sectionId,
      sectionLabel,
      resolveI18n(keyDef.label, lang),
      resolveI18n(keyDef.description, lang),
    ].filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => haystack.includes(t));
  };
}

// Walk the schema once and count how many keys pass the matcher.
// Used by the modal to render a "N / total" hint next to the search box.
export function countSchemaMatches(schema, matcher, lang) {
  if (!schema || !schema.sections) return { matched: 0, total: 0 };
  let matched = 0;
  let total = 0;
  for (const [sectionId, section] of Object.entries(schema.sections)) {
    const sectionLabel = resolveI18n(section.label, lang);
    for (const [keyName, keyDef] of Object.entries(section.keys || {})) {
      total++;
      if (matcher(keyName, keyDef, sectionId, sectionLabel)) matched++;
    }
  }
  return { matched, total };
}
