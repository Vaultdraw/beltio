/**
 * A tiny zip writer and a strict zip reader for plugin packages (no dependencies).
 *
 * Package layout (`<id>-<version>.zip`):
 *
 *   - Flat: `plugin.toml` and the other files sit at the zip root (no top folder).
 *   - Entry names are `/`-separated, relative, UTF-8, sorted by byte order.
 *   - Reproducible: every entry has the DOS time 1980-01-01 00:00:00, "version made by"
 *     = 3 (Unix) / 20, flags = 0x0800 (UTF-8 names), unix mode 0100644, no extra
 *     fields, no comment, no directory entries. Entries of 64 bytes or more are
 *     deflated (raw, level 9) when that is smaller, else stored. The same input
 *     gives the same bytes on one Node build (zlib output may differ between
 *     zlib versions).
 *
 * The reader is strict because a registry will read zips from strangers. It rejects:
 * absolute paths, drive letters, `.` and `..` segments, backslashes, control
 * characters, duplicate names (also by case), symbolic links, encrypted entries, zip64,
 * multi-disk archives, a zip comment, methods other than stored and deflate, sizes or
 * CRCs that do not match, more than MAX_ENTRIES entries and more than MAX_TOTAL_BYTES
 * of uncompressed data (zip bomb guard; inflation stops at the declared size).
 * Directory entries (names ending in `/`, size 0) are skipped.
 */
import zlib from "node:zlib";

export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_ENTRIES = 1000;
const STORE_BELOW = 64;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const VERSION_MADE_BY = (3 << 8) | 20;
const FLAG_UTF8 = 0x0800;
const UNIX_FILE_0644 = (0o100644 << 16) >>> 0;

/** Raised by the reader for any archive it refuses. */
export class ZipError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

/** @type {Uint32Array | null} */
let table = null;
/** @param {Uint8Array} buf @returns {number} */
export function crc32(buf) {
  if (typeof (/** @type {any} */ (zlib).crc32) === "function") {
    return /** @type {any} */ (zlib).crc32(buf) >>> 0;
  }
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The reason a name is not allowed in a package, or null.
 * @param {string} name
 * @returns {string | null}
 */
export function badEntryName(name) {
  if (name === "") {
    return "empty name";
  }
  if (name.includes("\\")) {
    return "backslash";
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return "control character";
  }
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    return "absolute path";
  }
  for (const seg of name.split("/")) {
    if (seg === "..") {
      return "'..' segment";
    }
    if (seg === "." || seg === "") {
      return "empty or '.' segment";
    }
  }
  return null;
}

/**
 * A message when two names clash: the same name in another case, or a name that is both a
 * file and a folder (`a` and `a/b`). Such a zip cannot be unpacked on every system.
 * @param {string[]} names
 * @returns {string | null}
 */
export function nameConflict(names) {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  if (lower.size < new Set(names).size) {
    return "Two entries differ only in letter case";
  }
  for (const n of names) {
    const parts = n.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      if (lower.has(parts.slice(0, i).join("/"))) {
        return `'${n}' is inside '${parts
          .slice(0, i)
          .join("/")}', which is also a file`;
      }
    }
  }
  return null;
}

/**
 * Builds a zip. Entries are sorted by name (byte order); same input gives the same bytes.
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
  );
  const clash = nameConflict(sorted.map((e) => e.name));
  if (clash) {
    throw new ZipError(clash);
  }
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  const seen = new Set();
  let total = 0;
  for (const { name, data } of sorted) {
    const bad = badEntryName(name);
    if (bad) {
      throw new ZipError(`Cannot add '${name}': ${bad}`);
    }
    if (seen.has(name)) {
      throw new ZipError(`Duplicate entry '${name}'`);
    }
    seen.add(name);
    total += data.length;
    const raw = Buffer.from(data);
    let method = 0;
    let body = raw;
    if (raw.length >= STORE_BELOW) {
      const z = zlib.deflateRawSync(raw, { level: 9 });
      if (z.length < raw.length) {
        method = 8;
        body = z;
      }
    }
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const version = method === 0 ? 10 : 20;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(SIG_CENTRAL, 0);
    cen.writeUInt16LE(VERSION_MADE_BY, 4);
    cen.writeUInt16LE(version, 6);
    cen.writeUInt16LE(FLAG_UTF8, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal attrs: zero
    cen.writeUInt32LE(UNIX_FILE_0644, 38);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, body);
    central.push(cen, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new ZipError(
      `The files add up to ${total} bytes; the limit is ${MAX_TOTAL_BYTES}`,
    );
  }
  if (sorted.length > MAX_ENTRIES) {
    throw new ZipError(`More than ${MAX_ENTRIES} files`);
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

/**
 * Reads a zip strictly (see the header comment).
 * @param {Uint8Array} bytes
 * @returns {{ name: string, data: Buffer }[]} in archive order
 */
export function readZip(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (/** @type {string} */ m) => {
    throw new ZipError(m);
  };
  if (buf.length < 22) {
    fail("Not a zip file (too short)");
  }
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== SIG_EOCD) {
    fail(
      "Not a zip file, or it has a zip comment (end of central directory not found)",
    );
  }
  if (buf.readUInt16LE(eocd + 20) !== 0) {
    fail("Zip comments are not allowed");
  }
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) {
    fail("zip64 archives are not supported");
  }
  const disk = buf.readUInt16LE(eocd + 4);
  const cenDisk = buf.readUInt16LE(eocd + 6);
  const countDisk = buf.readUInt16LE(eocd + 8);
  const count = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cenDisk !== 0 || countDisk !== count) {
    fail("Multi-disk archives are not supported");
  }
  if (count === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) {
    fail("zip64 archives are not supported");
  }
  if (count > MAX_ENTRIES) {
    fail(`More than ${MAX_ENTRIES} entries`);
  }
  if (cenOffset + cenSize > eocd) {
    fail("The central directory is out of bounds");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  /** @type {{ name: string, data: Buffer }[]} */
  const out = [];
  const names = new Set();
  let declaredTotal = 0;
  let p = cenOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      fail("The central directory is damaged");
    }
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34);
    const attrs = buf.readUInt32LE(p + 38);
    const lho = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen + elen + clen > eocd) {
      fail("The central directory is damaged");
    }
    let name;
    try {
      name = decoder.decode(buf.subarray(p + 46, p + 46 + nlen));
    } catch {
      return fail("An entry name is not valid UTF-8");
    }
    p += 46 + nlen + elen + clen;

    if (diskStart !== 0) {
      fail("Multi-disk archives are not supported");
    }
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
      fail("zip64 archives are not supported");
    }
    if (flags & 0x1 || flags & 0x40) {
      fail(`'${name}' is encrypted`);
    }
    const isDir = name.endsWith("/");
    const checkName = isDir ? name.slice(0, -1) : name;
    const bad = badEntryName(checkName);
    if (bad) {
      fail(`Entry '${name}' is not allowed: ${bad}`);
    }
    if (madeBy >> 8 === 3 && ((attrs >>> 16) & 0o170000) === 0o120000) {
      fail(`'${name}' is a symbolic link`);
    }
    if (method !== 0 && method !== 8) {
      fail(`'${name}' uses an unsupported compression method (${method})`);
    }
    if (isDir) {
      if (usize !== 0) {
        fail(`Directory entry '${name}' has data`);
      }
      continue;
    }
    const key = name.toLowerCase();
    if (names.has(name) || names.has(key)) {
      fail(`Duplicate entry '${name}'`);
    }
    names.add(name);
    names.add(key);
    declaredTotal += usize;
    if (declaredTotal > MAX_TOTAL_BYTES) {
      fail(
        `The archive expands to more than ${MAX_TOTAL_BYTES} bytes (zip bomb guard)`,
      );
    }
    if (method === 0 && csize !== usize) {
      fail(`'${name}': stored size does not match`);
    }

    // The local header only has to agree on the name; sizes come from the central directory.
    if (lho + 30 > cenOffset || buf.readUInt32LE(lho) !== SIG_LOCAL) {
      fail(`'${name}': local header not found`);
    }
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    if (
      start + csize > cenOffset ||
      buf.subarray(lho + 30, lho + 30 + lnlen).toString("utf8") !== name
    ) {
      fail(`'${name}': local header does not match`);
    }
    const body = buf.subarray(start, start + csize);
    /** @type {Buffer} */
    let data;
    if (method === 0) {
      data = Buffer.from(body);
    } else {
      try {
        data = zlib.inflateRawSync(body, {
          maxOutputLength: Math.max(usize, 1),
        });
      } catch {
        return fail(`'${name}' cannot be decompressed (damaged or too large)`);
      }
    }
    if (data.length !== usize) {
      fail(`'${name}': size does not match`);
    }
    if (crc32(data) !== crc) {
      fail(`'${name}': checksum does not match`);
    }
    out.push({ name, data });
  }
  if (p !== cenOffset + cenSize) {
    fail("The central directory has extra data");
  }
  const clash = nameConflict(out.map((e) => e.name));
  if (clash) {
    fail(clash);
  }
  return out;
}
