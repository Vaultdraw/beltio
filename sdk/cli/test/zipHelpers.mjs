import zlib from "node:zlib";

import { crc32 } from "../src/zip.mjs";

/**
 * Hand-builds a zip so tests can break one rule at a time.
 * Each entry: { name, data, method?, flags?, madeBy?, attrs?, csize?, usize?, crc?, lname? }
 */
export function rawZip(entries, { comment = "", eocd = {} } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const x of entries) {
    const raw = Buffer.from(x.data ?? "");
    const method = x.method ?? 0;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(x.name);
    const lname = Buffer.from(x.lname ?? x.name);
    const crc = x.crc ?? crc32(raw);
    const csize = x.csize ?? body.length;
    const usize = x.usize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(x.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(csize, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(lname.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(x.madeBy ?? (3 << 8) | 20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(x.flags ?? 0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(csize, 20);
    cen.writeUInt32LE(usize, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(x.attrs ?? (0o100644 << 16) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, lname, body);
    central.push(cen, name);
    offset += 30 + lname.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(eocd.disk ?? 0, 4);
  end.writeUInt16LE(eocd.cenDisk ?? 0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(eocd.count ?? entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...parts, cenBuf, end, Buffer.from(comment)]);
}
