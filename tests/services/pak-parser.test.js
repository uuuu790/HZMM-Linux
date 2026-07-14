import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readPakIndex } from '../../src/main/services/pak-parser.js'

// Synthesized paks following UE4's on-disk serialization:
//   v7-v9 index: MountPoint, NumEntries, [FString name + FPakEntry]* where the
//     CompressionBlocks array exists ONLY when CompressionMethod != 0.
//   v10/v11 index: MountPoint, NumEntries, PathHashSeed, PathHashIndex
//     descriptor, FullDirectoryIndex descriptor, … — names live in the
//     FullDirectoryIndex (TMap<Dir, TMap<File, entry>>), not the primary index.
// Regressions covered: uncompressed v8 entries used to desync after the first
// file; v10/v11 paks used to return [] (conflict scan blind to modern paks —
// HumanitZ is UE4.27, whose UnrealPak writes v11).

const PAK_MAGIC = 0x5a6f12e1

const fstring = (s) => {
  const bytes = Buffer.from(s + '\0', 'utf-8')
  const len = Buffer.alloc(4)
  len.writeInt32LE(bytes.length)
  return Buffer.concat([len, bytes])
}
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b }
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b }
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b }
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b }

// Serialized FPakEntry (v7/v8 layout).
function legacyEntry({ compressed = false, blocks = 0 } = {}) {
  const parts = [
    i64(0), i64(5), i64(5), // Offset, Size, UncompressedSize
    u32(compressed ? 1 : 0), // CompressionMethod (0 = NONE)
    Buffer.alloc(20), // Hash
  ]
  if (compressed) {
    parts.push(u32(blocks), Buffer.alloc(blocks * 16)) // CompressionBlocks
  }
  parts.push(Buffer.from([0]), u32(65536)) // bEncrypted, CompressionBlockSize
  return Buffer.concat(parts)
}

// Assemble [pre][index][padding][magic version indexOffset indexSize] with the
// index positioned after `pre` and the footer inside the last 221 bytes.
function buildPakFile(indexBuf, version, pre = Buffer.alloc(0)) {
  const body = Buffer.concat([pre, indexBuf])
  const footer = Buffer.concat([u32(PAK_MAGIC), i32(version), i64(pre.length), i64(indexBuf.length)])
  const padding = Buffer.alloc(Math.max(0, 221 - (body.length + footer.length)))
  return Buffer.concat([body, padding, footer])
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-pak-'))
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
let fileNo = 0
function writePak(buf) {
  const p = path.join(tmpDir, `test-${fileNo++}.pak`)
  fs.writeFileSync(p, buf)
  return p
}

describe('readPakIndex — legacy v8 index', () => {
  it('walks uncompressed entries without desyncing (no blocks array)', () => {
    const index = Buffer.concat([
      fstring('../../../'), i32(3),
      fstring('HumanitZ/Content/A.uasset'), legacyEntry(),
      fstring('HumanitZ/Content/B.uasset'), legacyEntry(),
      fstring('HumanitZ/Content/C.uasset'), legacyEntry(),
    ])
    expect(readPakIndex(writePak(buildPakFile(index, 8)))).toEqual([
      '../../../HumanitZ/Content/A.uasset',
      '../../../HumanitZ/Content/B.uasset',
      '../../../HumanitZ/Content/C.uasset',
    ])
  })

  it('walks mixed compressed/uncompressed entries', () => {
    const index = Buffer.concat([
      fstring('../../../'), i32(3),
      fstring('A.uasset'), legacyEntry(),
      fstring('B.uasset'), legacyEntry({ compressed: true, blocks: 2 }),
      fstring('C.uasset'), legacyEntry(),
    ])
    expect(readPakIndex(writePak(buildPakFile(index, 8)))).toEqual([
      '../../../A.uasset', '../../../B.uasset', '../../../C.uasset',
    ])
  })
})

describe('readPakIndex — v10/v11 FullDirectoryIndex', () => {
  function buildV11({ withFdi = true } = {}) {
    const fdi = Buffer.concat([
      i32(2),
      fstring('HumanitZ/Content/Paks/'), i32(2),
      fstring('A.uasset'), i32(0),
      fstring('B.uasset'), i32(1),
      fstring('/'), i32(1),
      fstring('root.txt'), i32(2),
    ])
    const primary = Buffer.concat([
      fstring('../../../'), i32(3),
      u64(0x123456789n), // PathHashSeed
      i32(1), i64(0), i64(0), Buffer.alloc(20), // PathHashIndex descriptor (unused)
      i32(withFdi ? 1 : 0),
      ...(withFdi ? [i64(0), i64(fdi.length), Buffer.alloc(20)] : []),
      i32(0), // EncodedPakEntriesSize
      i32(0), // FilesNum
    ])
    return buildPakFile(primary, 11, withFdi ? fdi : Buffer.alloc(0))
  }

  it('reads file names from the FullDirectoryIndex', () => {
    expect(readPakIndex(writePak(buildV11()))).toEqual([
      '../../../HumanitZ/Content/Paks/A.uasset',
      '../../../HumanitZ/Content/Paks/B.uasset',
      '../../../root.txt',
    ])
  })

  it('returns [] when the FullDirectoryIndex was not written', () => {
    expect(readPakIndex(writePak(buildV11({ withFdi: false })))).toEqual([])
  })
})

describe('readPakIndex — robustness', () => {
  it('returns [] for a file with no pak magic', () => {
    expect(readPakIndex(writePak(Buffer.alloc(512)))).toEqual([])
  })

  it('returns [] for a truncated/garbage index without throwing', () => {
    const index = Buffer.concat([fstring('../../../'), i32(50)]) // claims 50 entries, has none
    expect(readPakIndex(writePak(buildPakFile(index, 8)))).toEqual([])
  })
})
