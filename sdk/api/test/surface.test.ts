import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const snapshotFile = path.join(root, "etc", "api-surface.d.ts");

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
  return [...out.keys()]
    .sort()
    .map((k) => `// ${k.replace(/\.d\.ts$/, ".ts")}\n${out.get(k)}`)
    .join("\n");
};

describe("@vaultdraw/api public surface", () => {
  it("matches etc/api-surface.d.ts", () => {
    const actual = emitSurface();
    if (process.env.UPDATE_API_SURFACE === "1") {
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
        "and commit sdk/api/etc/api-surface.d.ts.",
    ).toBe(true);
  });
});
