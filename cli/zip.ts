import { deflateRawSync } from 'node:zlib'

/**
 * Writes a zip archive. Entries are stored in the order given, deflated,
 * with a fixed timestamp, so the same files always give the same bytes.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 1980-01-01 00:00, the earliest time a zip can record. */
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0x0800, 6) // UTF-8 names
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(entry.data.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)
    local.push(header, name, compressed)

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(0x031e, 4) // made by: Unix, zip 3.0
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(8, 10)
    record.writeUInt16LE(DOS_TIME, 12)
    record.writeUInt16LE(DOS_DATE, 14)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(compressed.length, 20)
    record.writeUInt32LE(entry.data.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a regular file, rw-r--r--
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += header.length + name.length + compressed.length
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  const out = Buffer.concat([...local, ...central, end])
  const bytes = new Uint8Array(new ArrayBuffer(out.length))
  bytes.set(out)
  return bytes
}
