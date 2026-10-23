import { describe, expect, it } from "vitest";

import { MAX_TOTAL_BYTES, readZip, writeZip, ZipError } from "../src/zip.mjs";

import { rawZip } from "./zipHelpers.mjs";

const e = (name, text) => ({ name, data: Buffer.from(text) });

const rejects = (buf, re) => {
  expect(() => readZip(buf)).toThrow(ZipError);
  expect(() => readZip(buf)).toThrow(re);
};

describe("zip writer and reader", () => {
  it("round trips, sorted, with small entries stored and big ones deflated", () => {
    const big = "x".repeat(5000);
    const zip = writeZip([e("b.txt", "bee"), e("a/z.js", big), e("a.md", "")]);
    const got = readZip(zip);
    expect(got.map((x) => x.name)).toEqual(["a.md", "a/z.js", "b.txt"]);
    expect(got[1].data.toString()).toBe(big);
    expect(got[2].data.toString()).toBe("bee");
    expect(zip.length).toBeLessThan(1000);
    // central directory: method of a/z.js is deflate (8), of b.txt stored (0)
    expect(zip.includes(Buffer.from([8, 0]))).toBe(true);
  });

  it("is reproducible: same input, same bytes, whatever the input order", () => {
    const files = [e("a", "x".repeat(500)), e("b/c", "hello"), e("d", "y")];
    const one = writeZip(files);
    const two = writeZip([...files].reverse());
    expect(one.equals(two)).toBe(true);
    // fixed time 1980-01-01 and Unix 0644
    expect(one.readUInt16LE(12)).toBe(0x21);
    expect(one.readUInt16LE(10)).toBe(0);
  });

  it("refuses bad names when writing", () => {
    expect(() => writeZip([e("../x", "")])).toThrow(ZipError);
    expect(() => writeZip([e("a", ""), e("a", "")])).toThrow(/Duplicate/);
  });

  it("refuses more than the size cap when writing", () => {
    expect(() =>
      writeZip([{ name: "big", data: Buffer.alloc(MAX_TOTAL_BYTES + 1) }]),
    ).toThrow(/limit/);
  });

  it("reads a hand-built valid zip, skipping directory entries", () => {
    const got = readZip(
      rawZip([
        { name: "d/", data: "" },
        { name: "d/f.txt", data: "hi", method: 8 },
      ]),
    );
    expect(got.map((x) => x.name)).toEqual(["d/f.txt"]);
  });

  it.each([
    ["absolute path", "/etc/passwd", /absolute/],
    ["drive letter", "C:/x", /absolute/],
    ["parent segment", "a/../b", /'\.\.'/],
    ["leading ..", "../b", /'\.\.'/],
    ["backslash", "a\\b", /backslash/],
    ["empty segment", "a//b", /segment/],
    ["dot segment", "./a", /segment/],
    ["control character", "a\nb", /control/],
  ])("rejects %s", (_n, name, re) => {
    rejects(rawZip([{ name, data: "x" }]), re);
  });

  it("rejects duplicate names, also by case", () => {
    rejects(
      rawZip([
        { name: "a", data: "1" },
        { name: "a", data: "2" },
      ]),
      /Duplicate/,
    );
    rejects(
      rawZip([
        { name: "a.js", data: "1" },
        { name: "A.js", data: "2" },
      ]),
      /Duplicate/,
    );
  });

  it("rejects symbolic links", () => {
    rejects(
      rawZip([{ name: "l", data: "target", attrs: (0o120777 << 16) >>> 0 }]),
      /symbolic link/,
    );
  });

  it("rejects encrypted entries and unsupported methods", () => {
    rejects(rawZip([{ name: "a", data: "x", flags: 1 }]), /encrypted/);
    rejects(rawZip([{ name: "a", data: "x", method: 12 }]), /method/);
  });

  it("rejects zip64, multi-disk and comments", () => {
    rejects(rawZip([{ name: "a", data: "x", csize: 0xffffffff }]), /zip64/);
    rejects(
      rawZip([{ name: "a", data: "x" }], { eocd: { disk: 1 } }),
      /Multi-disk/,
    );
    rejects(
      rawZip([{ name: "a", data: "x" }], { comment: "hi" }),
      /comment|not a zip/i,
    );
    rejects(
      rawZip([{ name: "a", data: "x" }], { eocd: { count: 0xffff } }),
      /Multi-disk|zip64/,
    );
  });

  it("rejects wrong crc and wrong sizes", () => {
    rejects(rawZip([{ name: "a", data: "xyz", crc: 1 }]), /checksum/);
    rejects(
      rawZip([{ name: "a", data: "xyz", usize: 2, csize: 3 }]),
      /does not match/,
    );
    rejects(
      rawZip([{ name: "a", data: "xyz", method: 8, usize: 2 }]),
      /decompressed|size/,
    );
  });

  it("rejects a local header whose name differs", () => {
    rejects(rawZip([{ name: "aa", data: "x", lname: "bb" }]), /local header/);
  });

  it("stops a zip bomb: declared and real sizes over the cap", () => {
    const bomb = Buffer.alloc(MAX_TOTAL_BYTES + 1024, 0);
    rejects(
      rawZip([{ name: "bomb", data: bomb, method: 8 }]),
      /zip bomb|too large/,
    );
    // Lies about its size: declares 10 bytes, inflates to 1 MB.
    rejects(
      rawZip([
        { name: "liar", data: Buffer.alloc(1 << 20), method: 8, usize: 10 },
      ]),
      /decompressed|too large/,
    );
  });

  it("rejects garbage and truncated files", () => {
    rejects(Buffer.from("not a zip at all, really not"), /zip/i);
    rejects(Buffer.alloc(5), /too short/);
    const ok = writeZip([e("a", "x")]);
    rejects(ok.subarray(0, ok.length - 3), /zip/i);
  });
});
