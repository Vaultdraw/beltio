#!/usr/bin/env node
// Writes a synthetic Obsidian vault for the import memory run: N notes (callouts, tables, wikilinks,
// one image each) and M real PNG attachments of noise (about 200 KB each), in 40 folders.
// Usage: node scripts/gen-obsidian-vault.mjs <dir> [notes=600] [attachments=500]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const [dir, notesArg, attArg] = process.argv.slice(2);
if (!dir) throw new Error("usage: gen-obsidian-vault.mjs <dir> [notes] [attachments]");
const notes = Number(notesArg ?? 600);
const attachments = Number(attArg ?? 500);
let seed = 11;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
};
/** A w x h RGB PNG of noise: incompressible, so the file is about w*h*3 bytes. */
const png = (w, h) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let i = 1; i <= w * 3; i++) raw[y * (w * 3 + 1) + i] = Math.floor(rnd() * 256);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
};
const vocab = Array.from({ length: 800 }, (_, i) => Array.from({ length: 2 + ((i * 7) % 9) }, (_, k) => String.fromCharCode(97 + ((i * 31 + k * 17) % 26))).join(""));
const words = (n) => Array.from({ length: n }, () => vocab[Math.floor(rnd() * 800)]).join(" ");
const put = (rel, data) => {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
};
for (let i = 0; i < notes; i++) {
  const link = () => `[[Note ${Math.floor(rnd() * notes)}]]`;
  put(`Area ${i % 40}/Note ${i}.md`, [
    `---\ntags: [a, b]\n---\n# Note ${i}\n`,
    `${words(60)} ${link()} ${words(20)} ${link()}.\n`,
    `> [!note] A callout\n> ${words(25)}\n`,
    `| a | b | c |\n| - | - | - |\n| ${words(2)} | ${words(2)} | ${words(2)} |\n`,
    `![[img-${Math.floor(rnd() * attachments)}.png]]\n`,
    `## Section\n\n${words(80)}\n`,
  ].join("\n"));
}
for (let i = 0; i < attachments; i++) put(`attachments/img-${i}.png`, png(150 + (i % 5) * 20, 150 + (i % 4) * 20));
console.log(`wrote ${notes} notes and ${attachments} attachments to ${dir}`);
