import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { readZip } from "../src/zip.mjs";

import { cleanup, makePlugin, MANIFEST, run, tmp, write } from "./helpers.mjs";
import { rawZip } from "./zipHelpers.mjs";

afterAll(cleanup);

const pack = (dir, outDir = tmp("vdp-out-"), ...extra) => {
  const r = run(["package", dir, "--out", outDir, ...extra]);
  return { ...r, zip: path.join(outDir, "demo-plugin-1.0.0.zip") };
};

describe("package", () => {
  it("writes a flat zip and a sha256 sidecar", () => {
    const dir = makePlugin({
      LICENSE: "MIT\n",
      "assets/icon.txt": "i",
      "node_modules/x/index.js": "no",
      ".hidden": "no",
      "main.test.js": "no",
    });
    const r = pack(dir);
    expect(r.code).toBe(0);
    const names = readZip(readFileSync(r.zip)).map((e) => e.name);
    expect(names).toEqual([
      "LICENSE",
      "README.md",
      "assets/icon.txt",
      "main.js",
      "plugin.toml",
    ]);
    const sha = createHash("sha256").update(readFileSync(r.zip)).digest("hex");
    expect(readFileSync(`${r.zip}.sha256`, "utf8")).toBe(
      `${sha}  demo-plugin-1.0.0.zip\n`,
    );
    expect(r.out).toContain(sha);
  });

  it("is reproducible", () => {
    const dir = makePlugin();
    const a = pack(dir);
    const b = pack(dir);
    expect(readFileSync(a.zip).equals(readFileSync(b.zip))).toBe(true);
    expect(readFileSync(`${a.zip}.sha256`, "utf8")).toBe(
      readFileSync(`${b.zip}.sha256`, "utf8"),
    );
  });

  it("defaults --out to the current folder and does not pack its own output", () => {
    const dir = makePlugin();
    const r = run(["package", "."], { cwd: dir });
    expect(r.code).toBe(0);
    const again = run(["package", "."], { cwd: dir });
    expect(again.code).toBe(0);
    const names = readZip(
      readFileSync(path.join(dir, "demo-plugin-1.0.0.zip")),
    ).map((e) => e.name);
    expect(names).not.toContain("demo-plugin-1.0.0.zip");
    expect(names).not.toContain("demo-plugin-1.0.0.zip.sha256");
  });

  it("does not pack its own output when --out is a folder inside the plugin", () => {
    const dir = makePlugin({});
    const first = pack(dir, path.join(dir, "release"));
    expect(first.code).toBe(0);
    const bytes = readFileSync(first.zip);
    const second = pack(dir, path.join(dir, "release"));
    expect(second.code).toBe(0);
    expect(readFileSync(second.zip).equals(bytes)).toBe(true);
    expect(readZip(bytes).some((x) => x.name.startsWith("release/"))).toBe(
      false,
    );
  });

  it("refuses a broken plugin, prints the errors and writes nothing", () => {
    const dir = makePlugin({ "main.js": null });
    write(dir, { "plugin.toml": MANIFEST.replace('"main.js"', '"gone.js"') });
    const r = pack(dir);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/main-missing/);
    expect(r.err).toMatch(/Not packaged/);
    expect(() => readFileSync(r.zip)).toThrow();
  });

  it("allows warnings (no README)", () => {
    const dir = makePlugin({ "README.md": null });
    const bad = path.join(dir, "README.md");
    expect(() => readFileSync(bad)).toThrow();
    const r = pack(dir);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/readme-missing/);
  });

  it("--json prints the result", () => {
    const r = pack(makePlugin(), undefined, "--json");
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ schemaVersion: 1, ok: true, entries: 3 });
    expect(j.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(j.bytes).toBe(readFileSync(j.file).length);
  });

  it("uses dist/ when the project root has no built main", () => {
    const dir = makePlugin({ "main.js": null });
    write(dir, {
      "dist/plugin.toml": MANIFEST,
      "dist/main.js": "export default {}\n",
    });
    const r = pack(dir);
    expect(r.code).toBe(0);
    expect(readZip(readFileSync(r.zip)).map((e) => e.name)).toEqual([
      "main.js",
      "plugin.toml",
    ]);
  });

  it("reports a missing folder and a missing argument as usage errors", () => {
    expect(run(["package", "/no/such/dir"]).code).toBe(2);
    expect(run(["package"]).code).toBe(2);
  });
});

describe("check on a zip", () => {
  const zipped = () => {
    const r = pack(makePlugin());
    return r.zip;
  };

  it("passes a produced package", () => {
    const r = run(["check", zipped()]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no problems/);
  });

  it("--json keeps the same shape", () => {
    const r = run(["check", zipped(), "--json"]);
    expect(JSON.parse(r.out)).toEqual({
      schemaVersion: 1,
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it("finds problems inside the zip, naming entries", () => {
    const zip = path.join(tmp(), "bad.zip");
    writeFileSync(
      zip,
      rawZip([
        { name: "plugin.toml", data: MANIFEST },
        { name: "main.js", data: 'import "lodash";\n' },
      ]),
    );
    const r = run(["check", zip, "--json"]);
    expect(r.code).toBe(1);
    const j = JSON.parse(r.out);
    expect(j.errors.map((e) => e.code)).toEqual(["imports-unshared"]);
    expect(j.errors[0].file).toBe("main.js");
  });

  it("detects a tampered package through the sha256 file", () => {
    const zip = zipped();
    const bytes = readFileSync(zip);
    writeFileSync(
      zip,
      rawZip([
        { name: "plugin.toml", data: MANIFEST },
        { name: "main.js", data: "export default {}" },
      ]),
    );
    expect(bytes.equals(readFileSync(zip))).toBe(false);
    const r = run(["check", zip, "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).errors.map((e) => e.code)).toContain(
      "zip-checksum",
    );
  });

  it("rejects a malformed sidecar", () => {
    const zip = zipped();
    writeFileSync(`${zip}.sha256`, "nonsense\n");
    const r = run(["check", zip, "--json"]);
    expect(JSON.parse(r.out).errors.map((e) => e.code)).toContain(
      "zip-checksum",
    );
  });

  it("rejects a nested top folder with zip-layout", () => {
    const zip = path.join(tmp(), "nested.zip");
    writeFileSync(
      zip,
      rawZip([
        { name: "demo/plugin.toml", data: MANIFEST },
        { name: "demo/main.js", data: "export default {}" },
      ]),
    );
    const r = run(["check", zip, "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).errors.map((e) => e.code)).toEqual(["zip-layout"]);
  });

  it("reports an unsafe archive as zip-invalid", () => {
    const zip = path.join(tmp(), "evil.zip");
    writeFileSync(zip, rawZip([{ name: "../evil", data: "x" }]));
    const r = run(["check", zip, "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).errors.map((e) => e.code)).toEqual([
      "zip-invalid",
    ]);
  });

  it("reports a zip without plugin.toml like a folder without one", () => {
    const zip = path.join(tmp(), "empty.zip");
    writeFileSync(zip, rawZip([{ name: "main.js", data: "x" }]));
    const r = run(["check", zip, "--json"]);
    expect(JSON.parse(r.out).errors.map((e) => e.code)).toEqual([
      "plugin-toml-missing",
    ]);
  });
});
