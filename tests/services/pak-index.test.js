import { describe, it, expect } from 'vitest';
import {
  PAK_MAGIC,
  FOOTER_READ_SIZE,
  readFString,
  parseFooter,
  parseLegacyIndex,
  parsePrimaryIndexHeader,
  parseFullDirectoryIndex,
} from '../../src/main/services/pak-index';

// ---- Synthetic-buffer builders (little-endian, matching UnrealPak on disk) ----

// FString: positive int32 length (bytes incl. null terminator) + UTF-8 + null.
function fstr(s) {
  const body = Buffer.from(s, 'utf-8');
  const buf = Buffer.alloc(4 + body.length + 1);
  buf.writeInt32LE(body.length + 1, 0);
  body.copy(buf, 4);
  buf[4 + body.length] = 0;
  return buf;
}
function i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n), 0); return b; }

// Legacy FPakEntry, uncompressed: Offset(8) Size(8) Uncompressed(8)
// CompressionMethod(4)=0 Hash(20) bEncrypted(1) CompressionBlockSize(4).
// NOTE: no CompressionBlocks array — that's the case the old parser mis-skipped.
function fpakUncompressed() {
  return Buffer.alloc(8 + 8 + 8 + 4 + 20 + 1 + 4); // method stays 0
}
// Legacy FPakEntry, compressed (method=1) with `blocks` compression blocks.
function fpakCompressed(blocks = 2) {
  const head = Buffer.alloc(8 + 8 + 8 + 4 + 20);
  head.writeUInt32LE(1, 24); // CompressionMethod at +24
  return Buffer.concat([head, u32(blocks), Buffer.alloc(blocks * 16), Buffer.alloc(1 + 4)]);
}

function buildLegacyIndex(mount, entries /* [{name, entry}] */) {
  const parts = [fstr(mount), i32(entries.length)];
  for (const e of entries) { parts.push(fstr(e.name), e.entry); }
  return Buffer.concat(parts);
}

function buildFullDirIndex(dirs /* [{name, files:[...]}] */) {
  const parts = [i32(dirs.length)];
  for (const d of dirs) {
    parts.push(fstr(d.name), i32(d.files.length));
    for (const f of d.files) parts.push(fstr(f), i32(0)); // + encoded-entry location
  }
  return Buffer.concat(parts);
}

function buildPrimaryV2(mount, { numEntries = 0, hasPathHash = true, hasFullDir = true, dirOffset = 0, dirSize = 0 }) {
  const parts = [fstr(mount), i32(numEntries), Buffer.alloc(8) /* PathHashSeed */];
  parts.push(i32(hasPathHash ? 1 : 0));
  if (hasPathHash) parts.push(Buffer.alloc(8 + 8 + 20));
  parts.push(i32(hasFullDir ? 1 : 0));
  if (hasFullDir) parts.push(i64(dirOffset), i64(dirSize), Buffer.alloc(20));
  return Buffer.concat(parts);
}

function buildFooter(version, indexOffset, indexSize) {
  const buf = Buffer.alloc(FOOTER_READ_SIZE);
  const pos = 40;
  buf.writeUInt32LE(PAK_MAGIC, pos);
  buf.writeInt32LE(version, pos + 4);
  buf.writeBigInt64LE(BigInt(indexOffset), pos + 8);
  buf.writeBigInt64LE(BigInt(indexSize), pos + 16);
  return buf;
}

// ---- Tests ----

describe('readFString', () => {
  it('reads a UTF-8 string and reports the field size', () => {
    const r = readFString(fstr('Hello'), 0);
    expect(r.str).toBe('Hello');
    expect(r.bytesRead).toBe(4 + 6); // len + "Hello\0"
  });
  it('reads an empty string', () => {
    expect(readFString(i32(0), 0)).toEqual({ str: '', bytesRead: 4 });
  });
});

describe('parseFooter', () => {
  it('locates the magic and reads version + index locator', () => {
    const footer = parseFooter(buildFooter(11, 1000, 500), 100000);
    expect(footer).toMatchObject({ version: 11, indexOffset: 1000, indexSize: 500 });
  });
  it('returns null when the index locator is out of range', () => {
    // indexSize (500) >= fileSize (100) → rejected.
    expect(parseFooter(buildFooter(11, 10, 500), 100)).toBeNull();
  });
});

describe('parseLegacyIndex (v7-8 inline names)', () => {
  it('reads every filename across MIXED compressed/uncompressed entries', () => {
    // Bug #2: an uncompressed entry has no CompressionBlocks array. The old code
    // read a phantom 4-byte block count after it, desyncing the walk and losing
    // every following name. Put an uncompressed entry FIRST so a regression drops
    // the second name.
    const buf = buildLegacyIndex('/', [
      { name: 'A.uasset', entry: fpakUncompressed() },
      { name: 'B.uasset', entry: fpakCompressed(2) },
      { name: 'C.uasset', entry: fpakUncompressed() },
    ]);
    expect(parseLegacyIndex(buf)).toEqual(['/A.uasset', '/B.uasset', '/C.uasset']);
  });

  it('prepends the mount point', () => {
    const buf = buildLegacyIndex('../../../Game/Content/', [
      { name: 'Mod.uasset', entry: fpakUncompressed() },
    ]);
    expect(parseLegacyIndex(buf)).toEqual(['../../../Game/Content/Mod.uasset']);
  });

  it('returns [] on a nonsense entry count', () => {
    expect(parseLegacyIndex(Buffer.concat([fstr('/'), i32(-5)]))).toEqual([]);
  });
});

describe('parsePrimaryIndexHeader (v10-11 path-hash index)', () => {
  it('locates the FullDirectoryIndex offset/size', () => {
    const buf = buildPrimaryV2('/', { numEntries: 3, dirOffset: 4096, dirSize: 256 });
    expect(parsePrimaryIndexHeader(buf)).toMatchObject({
      mountPoint: '/',
      numEntries: 3,
      fullDirIndexOffset: 4096,
      fullDirIndexSize: 256,
    });
  });

  it('handles no-path-hash / no-full-dir flags', () => {
    const buf = buildPrimaryV2('/', { hasPathHash: false, hasFullDir: false });
    const h = parsePrimaryIndexHeader(buf);
    expect(h.fullDirIndexOffset).toBeNull();
  });

  it('rejects garbage (e.g. a v9 frozen index) via the 0/1 flag guard', () => {
    // A frozen index puts non-0/1 bytes where bReaderHasPathHashIndex sits.
    const bogus = Buffer.concat([fstr('/'), i32(2), Buffer.alloc(8), i32(0x7fffffff)]);
    expect(parsePrimaryIndexHeader(bogus)).toBeNull();
  });
});

describe('parseFullDirectoryIndex (v10-11 real filenames)', () => {
  it('joins mount + directory + file into comparable paths', () => {
    const dirBuf = buildFullDirIndex([
      { name: 'Content/Paks/', files: ['Weapon.uasset', 'Weapon.uexp'] },
      { name: 'Content/', files: ['Data.uasset'] },
    ]);
    expect(parseFullDirectoryIndex(dirBuf, '/Game/')).toEqual([
      '/Game/Content/Paks/Weapon.uasset',
      '/Game/Content/Paks/Weapon.uexp',
      '/Game/Content/Data.uasset',
    ]);
  });

  it('collapses duplicate slashes so paths compare cleanly', () => {
    const dirBuf = buildFullDirIndex([{ name: '/Content/', files: ['A.uasset'] }]);
    expect(parseFullDirectoryIndex(dirBuf, '/')).toEqual(['/Content/A.uasset']);
  });

  it('produces the SAME path a legacy pak would for the same asset', () => {
    // Cross-format conflict detection relies on this equivalence.
    const legacy = parseLegacyIndex(
      buildLegacyIndex('/Game/', [{ name: 'Content/Foo.uasset', entry: fpakUncompressed() }])
    );
    const modern = parseFullDirectoryIndex(
      buildFullDirIndex([{ name: 'Content/', files: ['Foo.uasset'] }]),
      '/Game/'
    );
    expect(modern).toEqual(legacy);
  });

  it('returns [] on an absurd directory count', () => {
    expect(parseFullDirectoryIndex(i32(999999999), '/')).toEqual([]);
  });
});
