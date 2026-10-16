// Pure UE4 .pak index parsing — buffers in, resource-path list out.
//
// Split out of pak-parser.ts so it imports NOTHING electron-coupled (no logger /
// configStore), which makes it unit-testable with synthetic buffers under the
// node test runner. pak-parser.ts keeps the fs I/O and delegates the byte
// parsing here.
//
// Two on-disk index layouts are handled:
//   - Legacy inline index (pak versions 7-8): mount point, entry count, then a
//     flat list of [FString filename + FPakEntry metadata]. Filenames live
//     inline.
//   - Path-hash index v2 (pak versions 10-11, UnrealPak 4.26+): the primary
//     index no longer stores filenames — it points at a separate
//     FullDirectoryIndex whose (directory, file) FStrings are the real paths.
//     This is the modern default, so a manager that only parsed the legacy
//     layout silently saw ZERO files (and therefore zero conflicts) for most
//     current mod PAKs.
// Version 9 (FrozenIndex) is a raw memory image we don't decode; its garbage is
// rejected by the bounds checks below and yields [] (fail-safe, no false hits).

export const PAK_MAGIC = 0x5A6F12E1
export const FOOTER_READ_SIZE = 221
export const MAX_INDEX_SIZE = 100 * 1024 * 1024 // 100MB
export const MAX_COMPRESSION_BLOCKS = 10000
export const MAX_ENTRY_COUNT = 1000000
export const MAX_DIRECTORIES = 500000

// Read an Unreal FString at `offset`. Positive length = UTF-8 (incl. null
// terminator); negative length = UTF-16LE (units incl. null). Returns the
// decoded string (terminator stripped) and how many bytes the field occupied.
export interface FStringRead {
  str: string
  bytesRead: number
}

export function readFString(buffer: Buffer, offset: number): FStringRead {
  if (offset + 4 > buffer.length) return { str: '', bytesRead: 4 }

  let strLen = buffer.readInt32LE(offset)
  if (strLen === 0) return { str: '', bytesRead: 4 }

  // Int32 min would overflow when negated.
  if (strLen === -2147483648) return { str: '', bytesRead: 4 }

  const isUnicode = strLen < 0
  if (isUnicode) {
    strLen = -strLen
    const byteLen = strLen * 2
    if (offset + 4 + byteLen > buffer.length) return { str: '', bytesRead: 4 + byteLen }
    const str = buffer.toString('utf16le', offset + 4, offset + 4 + byteLen - 2)
    return { str, bytesRead: 4 + byteLen }
  }

  if (offset + 4 + strLen > buffer.length) return { str: '', bytesRead: 4 + strLen }
  const str = buffer.toString('utf-8', offset + 4, offset + 4 + strLen - 1)
  return { str, bytesRead: 4 + strLen }
}

// Scan the footer buffer backwards for the magic and read the index locator.
export interface PakFooter {
  version: number
  indexOffset: number
  indexSize: number
  bEncryptedIndex: number
}

export function parseFooter(buffer: Buffer, fileSize: number): PakFooter | null {
  for (let i = buffer.length - 4; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === PAK_MAGIC) {
      const magicOffset = i

      if (magicOffset + 8 > buffer.length) continue
      const version = buffer.readInt32LE(magicOffset + 4)
      if (version < 1 || version > 11) continue

      if (magicOffset + 16 > buffer.length) continue
      const indexOffset = Number(buffer.readBigInt64LE(magicOffset + 8))

      if (magicOffset + 24 > buffer.length) continue
      const indexSize = Number(buffer.readBigInt64LE(magicOffset + 16))

      // The encrypted-index flag's position varies by version and the old
      // magicOffset-1 read was wrong for v7+; assume not encrypted (an encrypted
      // index just yields garbage that the bounds checks reject → []).
      const bEncryptedIndex = 0

      // Require the index to lie fully inside the file: indexOffset + indexSize
      // must not run past EOF (checking each bound separately let a footer claim
      // an index that overruns the file, yielding a short/zero-filled read).
      if (indexOffset >= 0 && indexSize > 0 && indexSize < fileSize && indexOffset + indexSize <= fileSize) {
        return { version, indexOffset, indexSize, bEncryptedIndex }
      }
    }
  }
  return null
}

// Legacy inline index (pak versions 7-8). Returns the list of full resource
// paths (mountPoint + per-entry filename).
export function parseLegacyIndex(indexBuf: Buffer): string[] {
  const paths: string[] = []
  let offset = 0
  const { str: mountPoint, bytesRead: mpBytes } = readFString(indexBuf, offset)
  offset += mpBytes

  if (offset + 4 > indexBuf.length) return paths
  const entryCount = indexBuf.readInt32LE(offset)
  offset += 4
  if (entryCount <= 0 || entryCount > MAX_ENTRY_COUNT) return paths

  for (let i = 0; i < entryCount; i++) {
    if (offset >= indexBuf.length) break
    const { str: fileName, bytesRead } = readFString(indexBuf, offset)
    offset += bytesRead
    if (fileName) paths.push(mountPoint + fileName)

    // FPakEntry: int64 Offset, int64 Size, int64 UncompressedSize,
    //            uint32 CompressionMethod, byte[20] Hash,
    //            if CompressionMethod != 0: int32 blockCount + blockCount*16,
    //            byte bEncrypted, uint32 CompressionBlockSize.
    // The CompressionBlocks array is present ONLY when the entry is compressed —
    // the previous code read a 4-byte block count unconditionally, over-reading
    // by 4 bytes on every uncompressed entry (very common) and desyncing the
    // walk so all following filenames were lost.
    if (offset + 24 + 4 > indexBuf.length) break
    const compressionMethod = indexBuf.readUInt32LE(offset + 24)
    offset += 48 // 3×int64 (24) + method (4) + hash (20)
    if (offset > indexBuf.length) break

    if (compressionMethod !== 0) {
      if (offset + 4 > indexBuf.length) break
      const blockCount = indexBuf.readUInt32LE(offset)
      offset += 4
      if (blockCount > MAX_COMPRESSION_BLOCKS) break
      offset += blockCount * 16
      if (offset > indexBuf.length) break
    }
    offset += 1 // bEncrypted
    offset += 4 // CompressionBlockSize
    if (offset > indexBuf.length) break
  }
  return paths
}

// Parse just the header of a path-hash primary index (pak versions 10-11) —
// enough to locate the separate FullDirectoryIndex. Returns
// { mountPoint, numEntries, fullDirIndexOffset, fullDirIndexSize } or null if
// the buffer doesn't look like a valid v2 primary index (which is how a v9
// frozen index — or an encrypted one — safely falls through to []).
export interface PrimaryIndexHeader {
  mountPoint: string
  numEntries: number
  /** null when the index has no FullDirectoryIndex. */
  fullDirIndexOffset: number | null
  fullDirIndexSize: number | null
}

export function parsePrimaryIndexHeader(indexBuf: Buffer): PrimaryIndexHeader | null {
  let offset = 0
  const { str: mountPoint, bytesRead: mpBytes } = readFString(indexBuf, offset)
  offset += mpBytes

  if (offset + 4 > indexBuf.length) return null
  const numEntries = indexBuf.readInt32LE(offset)
  offset += 4
  if (numEntries < 0 || numEntries > MAX_ENTRY_COUNT) return null

  // uint64 PathHashSeed
  if (offset + 8 > indexBuf.length) return null
  offset += 8

  // int32 bReaderHasPathHashIndex (0/1); anything else = not a v2 index.
  if (offset + 4 > indexBuf.length) return null
  const hasPathHash = indexBuf.readInt32LE(offset)
  offset += 4
  if (hasPathHash !== 0 && hasPathHash !== 1) return null
  if (hasPathHash) {
    // int64 offset + int64 size + FSHAHash(20)
    if (offset + 8 + 8 + 20 > indexBuf.length) return null
    offset += 8 + 8 + 20
  }

  // int32 bReaderHasFullDirectoryIndex (0/1)
  if (offset + 4 > indexBuf.length) return null
  const hasFullDir = indexBuf.readInt32LE(offset)
  offset += 4
  if (hasFullDir !== 0 && hasFullDir !== 1) return null

  let fullDirIndexOffset: number | null = null
  let fullDirIndexSize: number | null = null
  if (hasFullDir) {
    if (offset + 8 + 8 + 20 > indexBuf.length) return null
    fullDirIndexOffset = Number(indexBuf.readBigInt64LE(offset))
    offset += 8
    fullDirIndexSize = Number(indexBuf.readBigInt64LE(offset))
    offset += 8
    offset += 20
  }

  return { mountPoint, numEntries, fullDirIndexOffset, fullDirIndexSize }
}

// Join a mount point + directory + file into one comparable path, matching the
// legacy layout's `mountPoint + fullRelativeName` so a v1 pak and a v2 pak that
// ship the same asset produce the SAME string (i.e. conflict correctly).
function joinPakPath(mountPoint: string, dirName: string, fileName: string): string {
  return `${mountPoint}${dirName}${fileName}`.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

// Parse a FullDirectoryIndex buffer (pak versions 10-11): int32 NumDirectories,
// then per directory an FString name + int32 file count, then per file an FString
// name + int32 encoded-entry location (skipped). Returns full resource paths.
export function parseFullDirectoryIndex(dirBuf: Buffer, mountPoint: string): string[] {
  const paths: string[] = []
  let offset = 0
  if (offset + 4 > dirBuf.length) return paths
  const numDirs = dirBuf.readInt32LE(offset)
  offset += 4
  if (numDirs < 0 || numDirs > MAX_DIRECTORIES) return paths

  for (let d = 0; d < numDirs; d++) {
    if (offset >= dirBuf.length) break
    const { str: dirName, bytesRead: dBytes } = readFString(dirBuf, offset)
    offset += dBytes

    if (offset + 4 > dirBuf.length) break
    const numFiles = dirBuf.readInt32LE(offset)
    offset += 4
    if (numFiles < 0 || numFiles > MAX_ENTRY_COUNT) break

    for (let f = 0; f < numFiles; f++) {
      if (offset >= dirBuf.length) break
      const { str: fileName, bytesRead: fBytes } = readFString(dirBuf, offset)
      offset += fBytes
      offset += 4 // int32 encoded-entry location — not needed for the file list
      if (offset > dirBuf.length) break
      if (fileName) paths.push(joinPakPath(mountPoint, dirName, fileName))
    }
  }
  return paths
}
