import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { API_REVISION } from "../shared/features";

import {
  refuseUpdate,
  removedLines,
  versionOf,
  withHeader,
} from "./surfaceRules";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const snapshotFile = path.join(root, "etc", "api-surface.d.ts");
const pkgVersion: string = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;

/** Names of the declarations tagged `@experimental` (outside the 1.0 promise). */
const experimentalNames = (): Set<string> => {
  const names = new Set<string>();
  for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith(".ts"))) {
    const text = fs.readFileSync(path.join(srcDir, f), "utf8");
    for (const m of text.matchAll(
      /\/\*\*(?:(?!\*\/)[\s\S])*?@experimental(?:(?!\*\/)[\s\S])*?\*\/\s*export (?:interface|type) (\w+)/g,
    )) {
      names.add(m[1]);
    }
  }
  return names;
};

/** Emits the public declarations (comments stripped), one block per source file, sorted by name. */
const emitSurface = (): string => {
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => path.join(srcDir, f));
  const out = new Map<string, string>();
  const options: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    removeComments: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
    rootDir: srcDir,
  };
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(files, options, host);
  const result = program.emit(undefined, (name, text) => {
    out.set(path.relative(srcDir, name), text);
  });
  const problems = ts
    .getPreEmitDiagnostics(program)
    .concat(result.diagnostics)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  if (problems.length > 0) {
    throw new Error(`sdk/api does not compile:\n${problems.join("\n")}`);
  }
  return withHeader(
    pkgVersion,
    [...out.keys()]
      .sort()
      .map((k) => `// ${k.replace(/\.d\.ts$/, ".ts")}\n${out.get(k)}`)
      .join("\n"),
  );
};

describe("@vaultdraw/api public surface", () => {
  it("matches etc/api-surface.d.ts", () => {
    const actual = emitSurface();
    if (process.env.UPDATE_API_SURFACE === "1") {
      const old = fs.existsSync(snapshotFile)
        ? fs.readFileSync(snapshotFile, "utf8")
        : null;
      const why = refuseUpdate(old, actual, pkgVersion, experimentalNames());
      if (why) {
        throw new Error(why);
      }
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
      fs.writeFileSync(snapshotFile, actual);
      return;
    }
    const expected = fs.existsSync(snapshotFile)
      ? fs.readFileSync(snapshotFile, "utf8")
      : "";
    expect(
      actual === expected,
      "The public API of @vaultdraw/api changed. If that is intended, run " +
        "`UPDATE_API_SURFACE=1 npx vitest run sdk/api/test/surface.test.ts` " +
        "and commit sdk/api/etc/api-surface.d.ts (raise the version in sdk/api/package.json first).",
    ).toBe(true);
  });

  it("is pinned at the version of package.json and of the app's API revision", () => {
    const snap = fs.readFileSync(snapshotFile, "utf8");
    expect(versionOf(snap)).toBe(pkgVersion);
    expect(API_REVISION).toBe(pkgVersion);
  });

  it("has a change log entry for the current version", () => {
    const log = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    expect(log).toMatch(
      new RegExp(`^## ${pkgVersion.replace(/\./g, "\\.")}\\b`, "m"),
    );
  });

  it("knows the experimental areas", () => {
    expect([...experimentalNames()].sort()).toEqual([
      "ThumbnailState",
      "ThumbnailsApi",
      "VaultGraphApi",
      "VaultTableApi",
      "VaultTableChange",
    ]);
  });
});

describe("surface update rules", () => {
  const a = (v: string, body: string) => withHeader(v, body);
  const base = "// x.ts\nexport interface A {\n    f(): void;\n}\n";
  const none = new Set<string>();

  it("lets an identical surface through at the same version", () => {
    expect(
      refuseUpdate(a("1.0.0", base), a("1.0.0", base), "1.0.0", none),
    ).toBe(null);
  });

  it("refuses any change without a version bump", () => {
    const next = a(
      "1.0.0",
      base.replace("f(): void;", "f(): void;\n    g(): void;"),
    );
    expect(refuseUpdate(a("1.0.0", base), next, "1.0.0", none)).toMatch(
      /still 1\.0\.0/,
    );
  });

  it("lets an addition through with a minor bump", () => {
    const next = a(
      "1.1.0",
      base.replace("f(): void;", "f(): void;\n    g(): void;"),
    );
    expect(refuseUpdate(a("1.0.0", base), next, "1.1.0", none)).toBe(null);
  });

  it.each([
    ["a removed member", "    f(): void;\n", ""],
    ["a changed signature", "f(): void;", "f(x: number): void;"],
    ["a renamed member", "f(): void;", "h(): void;"],
  ])("refuses %s in a minor release", (_n, from, to) => {
    const next = a("1.1.0", base.replace(from, to));
    expect(refuseUpdate(a("1.0.0", base), next, "1.1.0", none)).toMatch(
      /needs a major version/,
    );
  });

  it("lets a removal through with a major bump", () => {
    const next = a("2.0.0", base.replace("    f(): void;\n", ""));
    expect(refuseUpdate(a("1.0.0", base), next, "2.0.0", none)).toBe(null);
  });

  it("lets an experimental declaration change in a minor release", () => {
    const old = a("1.0.0", `${base}export interface E {\n    z(): void;\n}\n`);
    const next = a("1.1.0", `${base}export interface E {\n    y(): void;\n}\n`);
    const exp = new Set(["E"]);
    expect(removedLines(old, next, exp)).toEqual([]);
    expect(refuseUpdate(old, next, "1.1.0", exp)).toBe(null);
    expect(refuseUpdate(old, next, "1.1.0", none)).toMatch(/major/);
  });

  it("accepts the first snapshot", () => {
    expect(refuseUpdate(null, a("1.0.0", base), "1.0.0", none)).toBe(null);
  });
});
