import fs from 'fs'
import logger from './logger.js'

const PAK_MAGIC = 0x5A6F12E1
const FOOTER_READ_SIZE = 221
const MAX_INDEX_SIZE = 100 * 1024 * 1024 // 100MB limit to prevent OOM
const MAX_COMPRESSION_BLOCKS = 10000

function readFString(buffer, offset) {
  if (offset + 4 > buffer.length) return { str: '', bytesRead: 4 }

  let strLen = buffer.readInt32LE(offset)
  if (strLen === 0) return { str: '', bytesRead: 4 }

  // Guard against Int32 min value which would overflow when negated
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

function parseFooter(buffer, fileSize) {
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

      // Bug 6 fix: assume not encrypted instead of reading from unreliable offset.
      // The encrypted flag position varies by PAK version and the old code
      // (magicOffset - 1) was incorrect for v7+ footer layout.
      const bEncryptedIndex = 0

      if (indexOffset >= 0 && indexOffset < fileSize && indexSize > 0 && indexSize < fileSize) {
        return { version, indexOffset, indexSize, bEncryptedIndex }
      }
    }
  }

  return null
}

// v7-v9 legacy index: MountPoint, NumEntries, then [FString name + serialized
// FPakEntry] pairs. FPakEntry: Offset(8) + Size(8) + UncompressedSize(8) +
// CompressionMethod(4) + Hash(20), then — ONLY when CompressionMethod != 0 —
// the CompressionBlocks array (count + count*16), then bEncrypted(1) +
// CompressionBlockSize(4). UE serializes the blocks array conditionally, so
// reading it unconditionally desyncs the walk after the first uncompressed
// entry and truncates the file list (missing real conflicts).
function parseLegacyIndex(indexBuf) {
  let offset = 0
  const { str: mountPoint, bytesRead: mpBytes } = readFString(indexBuf, offset)
  offset += mpBytes

  if (offset + 4 > indexBuf.length) return []
  const entryCount = indexBuf.readInt32LE(offset)
  offset += 4

  if (entryCount <= 0 || entryCount > 1000000) return []

  const entries = []
  for (let i = 0; i < entryCount; i++) {
    if (offset >= indexBuf.length) break
    const { str: fileName, bytesRead } = readFString(indexBuf, offset)
    offset += bytesRead

    if (fileName) {
      entries.push(mountPoint + fileName)
    }

    // Need the fixed 48-byte header (compression method sits at +24).
    if (offset + 48 > indexBuf.length) break
    const compressionMethod = indexBuf.readUInt32LE(offset + 24)
    offset += 48

    if (compressionMethod !== 0) {
      if (offset + 4 > indexBuf.length) break
      const compressionBlockCount = indexBuf.readUInt32LE(offset)
      offset += 4
      // Sanity check block count to prevent huge offset jumps
      if (compressionBlockCount > MAX_COMPRESSION_BLOCKS) break
      offset += compressionBlockCount * 16
      if (offset > indexBuf.length) break // bounds check after block skip
    }
    offset += 1 // bEncrypted
    if (offset > indexBuf.length) break
    offset += 4 // compressionBlockSize
    if (offset > indexBuf.length) break
  }

  return entries
}

// v10/v11 primary index carries NO file names — after NumEntries comes
// PathHashSeed and descriptors pointing at two secondary indexes. File names
// live in the FullDirectoryIndex: TMap<DirectoryName, TMap<FileName, entry>>.
// (The old code walked the primary index as if it were name+entry pairs, read
// the 8-byte PathHashSeed as a string length, bailed, and returned [] for
// every modern pak — HumanitZ is UE4.27, whose UnrealPak writes v11.)
function parseV10PlusIndex(fd, indexBuf, fileSize, filePath) {
  let offset = 0
  const { str: mountPoint, bytesRead: mpBytes } = readFString(indexBuf, offset)
  offset += mpBytes

  if (offset + 4 > indexBuf.length) return []
  const entryCount = indexBuf.readInt32LE(offset)
  offset += 4
  if (entryCount <= 0 || entryCount > 1000000) return []

  offset += 8 // PathHashSeed (uint64)

  if (offset + 4 > indexBuf.length) return []
  const hasPathHashIndex = indexBuf.readInt32LE(offset)
  offset += 4
  if (hasPathHashIndex) {
    offset += 8 + 8 + 20 // PathHashIndex offset + size + hash
  }

  if (offset + 4 > indexBuf.length) return []
  const hasFullDirectoryIndex = indexBuf.readInt32LE(offset)
  offset += 4
  if (!hasFullDirectoryIndex) return [] // names are unrecoverable without it

  if (offset + 16 > indexBuf.length) return []
  const dirIndexOffset = Number(indexBuf.readBigInt64LE(offset))
  const dirIndexSize = Number(indexBuf.readBigInt64LE(offset + 8))

  if (dirIndexOffset < 0 || dirIndexSize <= 0 || dirIndexOffset + dirIndexSize > fileSize) return []
  if (dirIndexSize > MAX_INDEX_SIZE) {
    logger.warn(`PAK directory index too large (${dirIndexSize} bytes), skipping: ${filePath}`)
    return []
  }

  const dirBuf = Buffer.alloc(dirIndexSize)
  fs.readSync(fd, dirBuf, 0, dirIndexSize, dirIndexOffset)

  let pos = 0
  if (pos + 4 > dirBuf.length) return []
  const dirCount = dirBuf.readInt32LE(pos)
  pos += 4
  if (dirCount < 0 || dirCount > 1000000) return []

  const entries = []
  for (let d = 0; d < dirCount; d++) {
    const { str: dirName, bytesRead: dirBytes } = readFString(dirBuf, pos)
    pos += dirBytes
    if (pos + 4 > dirBuf.length) break
    const fileCount = dirBuf.readInt32LE(pos)
    pos += 4
    if (fileCount < 0 || fileCount > 1000000) break

    // Root directory is stored as "/"; other entries are already
    // slash-terminated relative paths ("HumanitZ/Content/Paks/").
    const dirPrefix = dirName === '/' ? '' : dirName
    for (let f = 0; f < fileCount; f++) {
      if (pos >= dirBuf.length) return entries
      const { str: fileName, bytesRead: fnBytes } = readFString(dirBuf, pos)
      pos += fnBytes
      pos += 4 // PakEntryLocation (int32)
      if (pos > dirBuf.length) return entries
      if (fileName) entries.push(mountPoint + dirPrefix + fileName)
    }
  }

  return entries
}

function readPakIndex(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    if (fileSize < FOOTER_READ_SIZE) return []

    const fd = fs.openSync(filePath, 'r')

    try {
      // Read footer area
      const footerBuf = Buffer.alloc(FOOTER_READ_SIZE)
      fs.readSync(fd, footerBuf, 0, FOOTER_READ_SIZE, fileSize - FOOTER_READ_SIZE)

      const footer = parseFooter(footerBuf, fileSize)
      if (!footer) return []

      if (footer.version < 7 || footer.version > 11) return []
      if (footer.bEncryptedIndex) return []

      // Bug 13 fix: prevent OOM from huge index allocation
      if (footer.indexSize > MAX_INDEX_SIZE) {
        logger.warn(`PAK index too large (${footer.indexSize} bytes), skipping: ${filePath}`)
        return []
      }

      // Read index
      const indexBuf = Buffer.alloc(footer.indexSize)
      fs.readSync(fd, indexBuf, 0, footer.indexSize, footer.indexOffset)

      // v7-v9 store [name + entry] pairs inline; v10/v11 moved names into the
      // FullDirectoryIndex secondary structure.
      if (footer.version <= 9) {
        return parseLegacyIndex(indexBuf)
      }
      return parseV10PlusIndex(fd, indexBuf, fileSize, filePath)
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    logger.warn(`Failed to parse PAK: ${filePath} — ${err.message}`)
    return []
  }
}

export { readPakIndex }
