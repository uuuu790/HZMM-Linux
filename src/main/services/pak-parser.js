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

      // Parse index: mount point string, then entry count, then entries
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

        // Skip entry metadata (variable size depending on version)
        if (offset + 4 <= indexBuf.length) {
          if (footer.version <= 8) {
            // v7-v8: offset(8) + size(8) + uncompressed(8) + compressionMethod(4) + hash(20) = 48
            offset += 48
            if (offset > indexBuf.length) break // bounds check after skip

            if (offset + 4 <= indexBuf.length) {
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
          } else {
            // v9+ encoded entry — VARIABLE size. The leading uint32 is a
            // bitfield encoding which of offset/uncompressed/size are 32- vs
            // 64-bit and how many compression blocks follow. The old fixed
            // `+= 12` only matched the uncompressed-32bit-safe case and desynced
            // the walk on any compressed/multi-block entry, truncating the file
            // list (and so missing real conflicts). Decode the bitfield to skip
            // the true record size. Bounds checks below keep a malformed entry
            // from over-reading.
            if (offset + 4 > indexBuf.length) break
            const flags = indexBuf.readUInt32LE(offset)
            offset += 4
            const compressionBlockCount = (flags >> 6) & 0xffff
            const bEncrypted = (flags >> 22) & 0x1
            const compressionMethodIndex = (flags >> 23) & 0x3f
            const bSizeIs32BitSafe = (flags >> 29) & 0x1
            const bUncompressedSizeIs32BitSafe = (flags >> 30) & 0x1
            const bOffsetIs32BitSafe = (flags >> 31) & 0x1
            offset += bOffsetIs32BitSafe ? 4 : 8            // Offset
            offset += bUncompressedSizeIs32BitSafe ? 4 : 8  // UncompressedSize
            if (compressionMethodIndex !== 0) {
              offset += bSizeIs32BitSafe ? 4 : 8            // Size (compressed only)
              // Blocks are stored explicitly only when there are >1 of them, or
              // exactly 1 but encrypted (single unencrypted block is derived).
              const storeBlocks = compressionBlockCount > 1 || (compressionBlockCount === 1 && bEncrypted)
              if (storeBlocks) {
                if (compressionBlockCount > MAX_COMPRESSION_BLOCKS) break
                offset += compressionBlockCount * 4         // each block: uint32
              }
            }
            if (offset > indexBuf.length) break
          }
        }
      }

      return entries
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    logger.warn(`Failed to parse PAK: ${filePath} — ${err.message}`)
    return []
  }
}

export { readPakIndex }
