import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  stripOrderPrefix,
  isPakFormOfMod,
  comparePakNames,
  pickWinningName,
  buildOrderTargets,
  executeOrderRenames,
  migrateProfiles,
  migrateReceipts,
  migrateCustomNames,
  migrateHybridLinks,
} from '../../src/main/ipc/mods-order'

describe('stripOrderPrefix', () => {
  it('strips z<N>_ prefixes of any escalation level', () => {
    expect(stripOrderPrefix('z1_Foo_P.pak')).toBe('Foo_P.pak')
    expect(stripOrderPrefix('zz12_Foo.pak')).toBe('Foo.pak')
    expect(stripOrderPrefix('ZZ3_Foo.pak')).toBe('Foo.pak')
  })

  it('leaves ordinary names alone (zebra has no digit+underscore)', () => {
    expect(stripOrderPrefix('zebra.pak')).toBe('zebra.pak')
    expect(stripOrderPrefix('Foo_P.pak')).toBe('Foo_P.pak')
    expect(stripOrderPrefix('z_Foo.pak')).toBe('z_Foo.pak')
  })

  it('strips exactly-three-digit reorder prefixes, nothing shorter or longer', () => {
    expect(stripOrderPrefix('010_Foo_P.pak')).toBe('Foo_P.pak')
    expect(stripOrderPrefix('10_Foo.pak')).toBe('10_Foo.pak')
    expect(stripOrderPrefix('0100_Foo.pak')).toBe('0100_Foo.pak')
  })
})

describe('isPakFormOfMod', () => {
  it('matches every plain on-disk form of the mod name', () => {
    expect(isPakFormOfMod('Cool_P.pak', 'Cool')).toBe(true)
    expect(isPakFormOfMod('Cool.pak', 'Cool')).toBe(true)
    expect(isPakFormOfMod('Cool_P.pak.disabled', 'Cool')).toBe(true)
    expect(isPakFormOfMod('cool_p.pak', 'Cool')).toBe(true) // Windows fs is case-insensitive
  })

  it('matches load-order-prefixed forms (the update rotation regression)', () => {
    // Regression: the old fixed candidate list missed z1_Cool_P.pak, so an
    // update left the old prefixed pak behind — and it kept winning the
    // alphabetical mount order over the new version.
    expect(isPakFormOfMod('z1_Cool_P.pak', 'Cool')).toBe(true)
    expect(isPakFormOfMod('zz12_Cool.pak', 'Cool')).toBe(true)
    expect(isPakFormOfMod('010_Cool_P.pak.disabled', 'Cool')).toBe(true)
  })

  it('matches mods whose name RETAINS a lowercase _p suffix — without swallowing the stripped name', () => {
    // Name derivation strips only an uppercase _P, so a pak shipped as
    // cool_p.pak yields mod.name 'cool_p' — its own files must still match
    // (the old candidate list handled these via case-insensitive existsSync),
    // but mod 'Sharp_p' must NOT match the unrelated mod Sharp's pak.
    expect(isPakFormOfMod('cool_p.pak', 'cool_p')).toBe(true)
    expect(isPakFormOfMod('cool_p.pak.disabled', 'cool_p')).toBe(true)
    expect(isPakFormOfMod('z1_cool_p.pak', 'cool_p')).toBe(true)
    expect(isPakFormOfMod('Sharp.pak', 'Sharp_p')).toBe(false)
  })

  it('matches a double _P name exactly, like the old candidate list', () => {
    // Cool_P_P.pak derives mod.name 'Cool_P' (one _P stripped); the candidate
    // set contains name + '_P.pak' so the raw file still matches.
    expect(isPakFormOfMod('Cool_P_P.pak', 'Cool_P')).toBe(true)
    expect(isPakFormOfMod('z1_Cool_P_P.pak', 'Cool_P')).toBe(true)
  })

  it('matches the pak’s IoStore siblings (.ucas/.utoc)', () => {
    // ucas/utoc land in the paks dir with the pak and must rotate with it —
    // otherwise an update collides and writes "X (2).ucas", breaking the mod.
    expect(isPakFormOfMod('Cool.ucas', 'Cool')).toBe(true)
    expect(isPakFormOfMod('Cool.utoc', 'Cool')).toBe(true)
    expect(isPakFormOfMod('z1_Cool_P.ucas', 'Cool')).toBe(true)
    expect(isPakFormOfMod('Cooler.ucas', 'Cool')).toBe(false)
  })

  it('accepts its own prefix-named forms but never swallows the unprefixed mod', () => {
    // A mod legitimately NAMED z1_Cool / 010_Map matches its own files
    // exactly, but must NOT match the unrelated mod Cool / Map — rotation
    // would move that mod's pak into a backup that gets deleted on success.
    expect(isPakFormOfMod('z1_Cool_P.pak', 'z1_Cool')).toBe(true)
    expect(isPakFormOfMod('010_map.pak', '010_Map')).toBe(true)
    expect(isPakFormOfMod('Cool_P.pak', 'z1_Cool')).toBe(false)
    expect(isPakFormOfMod('Map_P.pak', '010_Map')).toBe(false)
  })

  it('rejects other mods and non-pak-family files', () => {
    expect(isPakFormOfMod('Cooler_P.pak', 'Cool')).toBe(false)
    expect(isPakFormOfMod('z1_Cooler_P.pak', 'Cool')).toBe(false)
    expect(isPakFormOfMod('Cool.txt', 'Cool')).toBe(false)
    expect(isPakFormOfMod('Cool_P.pak (2)', 'Cool')).toBe(false)
    expect(isPakFormOfMod('', 'Cool')).toBe(false)
    expect(isPakFormOfMod('Cool_P.pak', '')).toBe(false)
  })
})

describe('buildOrderTargets', () => {
  it('is a no-op when the sequence is already ascending', () => {
    expect(buildOrderTargets(['Alpha.pak', 'Beta.pak', 'zebra.pak'])).toEqual([])
    expect(buildOrderTargets(['010_B.pak', 'Charlie.pak'])).toEqual([])
  })

  it('renumbers the whole sequence when order requires it, replacing old prefixes', () => {
    expect(buildOrderTargets(['z1_Bravo.pak', 'Alpha.pak'])).toEqual([
      { from: 'z1_Bravo.pak', to: '010_Bravo.pak' },
      { from: 'Alpha.pak', to: '020_Alpha.pak' },
    ])
  })

  it('filters out entries whose name already matches the target', () => {
    expect(buildOrderTargets(['020_B.pak', '010_A.pak'])).toEqual([
      { from: '020_B.pak', to: '010_B.pak' },
      { from: '010_A.pak', to: '020_A.pak' },
    ])
    expect(buildOrderTargets(['010_B.pak', '020_A.pak', '015_C.pak'])).toEqual([
      { from: '020_A.pak', to: '020_A.pak' },
      { from: '015_C.pak', to: '030_C.pak' },
    ].filter(t => t.from !== t.to))
  })

  it('re-applying its own output is a no-op (idempotent)', () => {
    const targets = buildOrderTargets(['Delta.pak', 'Alpha.pak', 'Charlie.pak'])
    const newOrder = ['Delta.pak', 'Alpha.pak', 'Charlie.pak'].map(n => {
      const t = targets.find(x => x.from === n)
      return t ? t.to : n
    })
    expect(buildOrderTargets(newOrder)).toEqual([])
  })
})

describe('executeOrderRenames', () => {
  const makeFakeFs = (initial) => {
    const files = new Set(initial)
    const calls = []
    return {
      files,
      calls,
      io: {
        exists: (n) => files.has(n),
        rename: (from, to) => {
          if (!files.has(from)) throw new Error(`missing ${from}`)
          files.delete(from)
          files.add(to)
          calls.push([from, to])
        },
      },
    }
  }

  it('renames without temps when no targets collide', () => {
    const fake = makeFakeFs(['Bravo.pak', 'Alpha.pak'])
    const summary = executeOrderRenames(
      [{ from: 'Bravo.pak', to: '010_Bravo.pak' }, { from: 'Alpha.pak', to: '020_Alpha.pak' }],
      fake.io
    )
    expect(summary).toEqual({ renamed: 2, skipped: 0 })
    expect([...fake.files].sort()).toEqual(['010_Bravo.pak', '020_Alpha.pak'])
    expect(fake.calls).toHaveLength(2)
  })

  it('breaks a true swap cycle via a temp name', () => {
    const fake = makeFakeFs(['010_A.pak', '020_A.pak'])
    const summary = executeOrderRenames(
      [{ from: '020_A.pak', to: '010_A.pak' }, { from: '010_A.pak', to: '020_A.pak' }],
      fake.io
    )
    expect(summary.renamed).toBe(2)
    expect([...fake.files].sort()).toEqual(['010_A.pak', '020_A.pak'])
    // one bounce through a ztmp name plus the two final renames
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls.some(([, to]) => to.startsWith('ztmp'))).toBe(true)
  })

  it('skips sources that vanished from disk without failing the rest', () => {
    const fake = makeFakeFs(['Alpha.pak'])
    const summary = executeOrderRenames(
      [{ from: 'Ghost.pak', to: '010_Ghost.pak' }, { from: 'Alpha.pak', to: '020_Alpha.pak' }],
      fake.io
    )
    expect(summary).toEqual({ renamed: 1, skipped: 1 })
    expect(fake.files.has('020_Alpha.pak')).toBe(true)
  })
})

describe('comparePakNames', () => {
  it('is case-insensitive lexical', () => {
    expect(comparePakNames('Alpha.pak', 'beta.pak')).toBeLessThan(0)
    expect(comparePakNames('ZEBRA.pak', 'apple.pak')).toBeGreaterThan(0)
    expect(comparePakNames('Same.pak', 'same.pak')).toBe(0)
  })
})

describe('pickWinningName', () => {
  it('returns the name unchanged when it already wins', () => {
    expect(pickWinningName('zzz.pak', ['aaa.pak', 'bbb.pak'])).toBe('zzz.pak')
  })

  it('prefixes z1_ to beat plain rivals', () => {
    expect(pickWinningName('Alpha_P.pak', ['Beta_P.pak'])).toBe('z1_Alpha_P.pak')
  })

  it('escalates to zz when a rival name itself sorts into the z-range', () => {
    expect(pickWinningName('Alpha.pak', ['zebra.pak'])).toBe('zz1_Alpha.pak')
  })

  it('replaces an existing prefix instead of stacking', () => {
    const result = pickWinningName('z1_Alpha.pak', ['z2_Beta.pak'])
    expect(result).toBe('z3_Alpha.pak')
    expect(result.includes('z1_z')).toBe(false)
  })

  it('ignores itself in the competitor list', () => {
    expect(pickWinningName('zzz.pak', ['zzz.pak', 'aaa.pak'])).toBe('zzz.pak')
  })

  it('throws when no prefix within the cap can win', () => {
    expect(() => pickWinningName('a.pak', ['zzzzzz.pak'])).toThrow(/winning/i)
  })
})

describe('store migrations (pure)', () => {
  it('migrateProfiles rewrites exact and .disabled filenames only', () => {
    const profiles = [
      { id: 1, enabledModFilenames: ['Alpha_P.pak', 'Other.pak', 'Alpha_P.pak.disabled'] },
      { id: 2, enabledModFilenames: ['Unrelated.pak'] },
    ]
    const out = migrateProfiles(profiles, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out[0].enabledModFilenames).toEqual(['z1_Alpha_P.pak', 'Other.pak', 'z1_Alpha_P.pak.disabled'])
    expect(out[1].enabledModFilenames).toEqual(['Unrelated.pak'])
  })

  it('migrateReceipts rewrites PAK localMods by base name, leaves UE4SS alone', () => {
    const receipts = [
      { modId: 1, localMods: [{ modType: 'PAK', name: 'Alpha' }, { modType: 'UE4SS', name: 'Alpha' }] },
      { modId: 2, localMods: [{ modType: 'PAK', name: 'Other' }] },
    ]
    const out = migrateReceipts(receipts, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out[0].localMods[0]).toEqual({ modType: 'PAK', name: 'z1_Alpha' })
    expect(out[0].localMods[1]).toEqual({ modType: 'UE4SS', name: 'Alpha' })
    expect(out[1].localMods[0]).toEqual({ modType: 'PAK', name: 'Other' })
  })

  it('migrateCustomNames moves the custom name to the new key', () => {
    const names = { 'Alpha_P.pak': '我的最愛', 'Other.pak': 'x' }
    const out = migrateCustomNames(names, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out['z1_Alpha_P.pak']).toBe('我的最愛')
    expect(out['Alpha_P.pak']).toBeUndefined()
    expect(out['Other.pak']).toBe('x')
  })

  it('migrateCustomNames is a no-op when the key is absent', () => {
    const names = { 'Other.pak': 'x' }
    expect(migrateCustomNames(names, 'Alpha_P.pak', 'z1_Alpha_P.pak')).toBe(names)
  })
})

describe('migrateHybridLinks (fs)', () => {
  let ue4ss
  beforeEach(() => {
    ue4ss = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-order-'))
  })
  afterEach(() => {
    fs.rmSync(ue4ss, { recursive: true, force: true })
  })

  it('rewrites matching pakFiles entries and leaves others untouched', () => {
    const modA = path.join(ue4ss, 'ModA')
    const modB = path.join(ue4ss, 'ModB')
    fs.mkdirSync(modA); fs.mkdirSync(modB)
    fs.writeFileSync(path.join(modA, '_hzmm_link.json'), JSON.stringify({ pakFiles: ['Alpha_P.pak', 'Keep.pak'] }))
    fs.writeFileSync(path.join(modB, '_hzmm_link.json'), JSON.stringify({ pakFiles: ['Unrelated.pak'] }))

    migrateHybridLinks(ue4ss, 'Alpha_P.pak', 'z1_Alpha_P.pak')

    const a = JSON.parse(fs.readFileSync(path.join(modA, '_hzmm_link.json'), 'utf-8'))
    const b = JSON.parse(fs.readFileSync(path.join(modB, '_hzmm_link.json'), 'utf-8'))
    expect(a.pakFiles).toEqual(['z1_Alpha_P.pak', 'Keep.pak'])
    expect(b.pakFiles).toEqual(['Unrelated.pak'])
    expect(fs.existsSync(path.join(modA, '_hzmm_link.json.tmp'))).toBe(false)
  })

  it('matches entries recorded in .disabled form', () => {
    const modA = path.join(ue4ss, 'ModA')
    fs.mkdirSync(modA)
    fs.writeFileSync(path.join(modA, '_hzmm_link.json'), JSON.stringify({ pakFiles: ['Alpha_P.pak.disabled'] }))
    migrateHybridLinks(ue4ss, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    const a = JSON.parse(fs.readFileSync(path.join(modA, '_hzmm_link.json'), 'utf-8'))
    expect(a.pakFiles).toEqual(['z1_Alpha_P.pak'])
  })
})
