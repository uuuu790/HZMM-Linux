import { describe, it, expect } from 'vitest';
import { buildKeyMatcher, countSchemaMatches } from '../../src/renderer/src/utils/config-search.js';

// A small schema fixture covering: 2 sections, mixed labels, keys with
// description / no description, keys whose name is the only match clue.
const schema = {
  sections: {
    Combat: {
      label: { en: 'Combat', 'zh-TW': '戰鬥' },
      keys: {
        Damage: {
          type: 'float',
          label: { en: 'Damage Multiplier', 'zh-TW': '傷害倍率' },
          description: { en: 'Multiplier applied to weapon damage' },
        },
        BP_AK47Rifle: {
          type: 'float',
          label: { en: 'AK-47 Rifle Damage' },
        },
      },
    },
    Audio: {
      label: { en: 'Audio', 'zh-TW': '音效' },
      keys: {
        Volume: {
          type: 'float',
          label: { en: 'Master Volume' },
          description: { en: 'Overall audio level' },
        },
      },
    },
  },
};

describe('buildKeyMatcher', () => {
  it('returns an accept-all matcher when query is empty', () => {
    const m = buildKeyMatcher('', 'en');
    expect(m('Damage', schema.sections.Combat.keys.Damage, 'Combat', 'Combat')).toBe(true);
  });

  it('returns an accept-all matcher when query is whitespace only', () => {
    const m = buildKeyMatcher('   ', 'en');
    expect(m('Damage', schema.sections.Combat.keys.Damage, 'Combat', 'Combat')).toBe(true);
  });

  it('matches against the key label (current language)', () => {
    const m = buildKeyMatcher('multiplier', 'en');
    expect(m('Damage', schema.sections.Combat.keys.Damage, 'Combat', 'Combat')).toBe(true);
    expect(m('Volume', schema.sections.Audio.keys.Volume, 'Audio', 'Audio')).toBe(false);
  });

  it('matches against the description', () => {
    const m = buildKeyMatcher('weapon', 'en');
    expect(m('Damage', schema.sections.Combat.keys.Damage, 'Combat', 'Combat')).toBe(true);
  });

  it('matches against the section id / label', () => {
    const m = buildKeyMatcher('audio', 'en');
    expect(m('Volume', schema.sections.Audio.keys.Volume, 'Audio', 'Audio')).toBe(true);
    expect(m('Damage', schema.sections.Combat.keys.Damage, 'Combat', 'Combat')).toBe(false);
  });

  it('matches against the bare key name', () => {
    const m = buildKeyMatcher('AK47', 'en');
    expect(m('BP_AK47Rifle', schema.sections.Combat.keys.BP_AK47Rifle, 'Combat', 'Combat')).toBe(true);
  });

  it('treats multiple terms as AND', () => {
    const m = buildKeyMatcher('AK47 damage', 'en');
    // BP_AK47Rifle has both "AK47" (in name) and "damage" (in label "AK-47 Rifle Damage")
    expect(m('BP_AK47Rifle', schema.sections.Combat.keys.BP_AK47Rifle, 'Combat', 'Combat')).toBe(true);
    // Volume key has neither term
    expect(m('Volume', schema.sections.Audio.keys.Volume, 'Audio', 'Audio')).toBe(false);
  });

  it('is case insensitive', () => {
    const m = buildKeyMatcher('VOLUME', 'en');
    expect(m('Volume', schema.sections.Audio.keys.Volume, 'Audio', 'Audio')).toBe(true);
  });

  it('respects current language when matching i18n labels', () => {
    const m = buildKeyMatcher('傷害', 'zh-TW');
    expect(m('Damage', schema.sections.Combat.keys.Damage, 'Combat', '戰鬥')).toBe(true);
  });
});

describe('countSchemaMatches', () => {
  it('counts every key when query is empty', () => {
    const matcher = buildKeyMatcher('', 'en');
    expect(countSchemaMatches(schema, matcher, 'en')).toEqual({ matched: 3, total: 3 });
  });

  it('counts only matching keys', () => {
    const matcher = buildKeyMatcher('volume', 'en');
    expect(countSchemaMatches(schema, matcher, 'en')).toEqual({ matched: 1, total: 3 });
  });

  it('returns 0/0 for null schema (defensive)', () => {
    expect(countSchemaMatches(null, () => true, 'en')).toEqual({ matched: 0, total: 0 });
  });

  it('returns 0/0 for schema with no sections', () => {
    expect(countSchemaMatches({}, () => true, 'en')).toEqual({ matched: 0, total: 0 });
  });

  it('handles section with empty keys gracefully', () => {
    const empty = { sections: { Foo: { label: { en: 'Foo' } } } };
    expect(countSchemaMatches(empty, () => true, 'en')).toEqual({ matched: 0, total: 0 });
  });
});
