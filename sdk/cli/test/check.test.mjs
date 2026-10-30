import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkPlugin, scanImports } from "../src/check.mjs";
import { validateManifestText } from "../src/manifest.mjs";
import { SHARED_SPECIFIERS } from "../src/shared.mjs";

import {
  cleanup,
  makePlugin,
  MANIFEST,
  REPO,
  run,
  SDK,
  write,
} from "./helpers.mjs";

afterAll(cleanup);

const CORPUS = path.join(SDK, "api", "test", "manifests");
const codes = (r) => r.errors.map((e) => e.code);

describe("manifest corpus", () => {
  for (const kind of ["ok", "bad"]) {
    for (const file of readdirSync(path.join(CORPUS, kind)).filter((f) =>
      f.endsWith(".toml"),
    )) {
      const text = readFileSync(path.join(CORPUS, kind, file), "utf8");
      const expected = /^# code: (\S+)/m.exec(text)?.[1];
      it(`${kind}/${file}`, () => {
        expect(expected).toBeTruthy();
        const r = validateManifestText(text);
        if (kind === "ok") {
          expect(expected).toBe("none");
          expect(r.errors).toEqual([]);
        } else {
          expect(codes(r)).toContain(expected);
        }
      });
    }
  }

  it("has at least the documented codes", () => {
    const have = new Set(
      readdirSync(path.join(CORPUS, "bad")).map((f) =>
        f.replace(/\.toml$/, ""),
      ),
    );
    for (const c of [
      "toml-parse",
      "unknown-key",
      "missing-key",
      "id-invalid",
      "dev-true",
      "too-many",
    ]) {
      expect(have.has(c)).toBe(true);
    }
  });
});

describe("validateManifestText", () => {
  const base = MANIFEST;
  const with_ = (extra) => validateManifestText(`${base}${extra}`);

  it("accepts the minimal manifest and tables named x-*", () => {
    expect(validateManifestText(base)).toEqual({ errors: [], warnings: [] });
    expect(with_('\n[x-tool]\nanything = "goes"\n').errors).toEqual([]);
  });

  it("reports findings with a code, a message and the file", () => {
    const r = validateManifestText(
      base.replace('"demo-plugin"', '"Demo_Plugin"'),
    );
    expect(r.errors).toEqual([
      {
        code: "id-invalid",
        message: expect.stringContaining("Demo_Plugin"),
        file: "plugin.toml",
      },
    ]);
  });

  it("accepts api = 1; api = 0 loads but warns; api = 2 is refused", () => {
    expect(with_("").warnings).toEqual([]);
    const legacy = validateManifestText(base.replace("api = 1", "api = 0"));
    expect(legacy.errors).toEqual([]);
    expect(legacy.warnings.map((w) => w.code)).toEqual(["api-deprecated"]);
    expect(
      codes(validateManifestText(base.replace("api = 1", "api = 2"))),
    ).toEqual(["api-unsupported"]);
  });

  it("checks min_api is a semantic version", () => {
    expect(with_('min_api = "1.0.0"\n').errors).toEqual([]);
    expect(codes(with_('min_api = "1.2"\n'))).toEqual(["min-api-invalid"]);
  });

  it("keeps going after the first problem", () => {
    const r = validateManifestText(
      `id = "x"\nname = ""\nversion = "1"\napi = 3\nmain = "/abs"\ncolour = 1\n`,
    );
    expect(codes(r).sort()).toEqual(
      [
        "api-unsupported",
        "id-invalid",
        "main-path-invalid",
        "name-invalid",
        "unknown-key",
        "version-invalid",
      ].sort(),
    );
  });

  it.each([
    ["main = '../x.js'", "main-path-invalid"],
    ["main = 'a//b.js'", "main-path-invalid"],
    ["main = 'a\\\\b.js'", "main-path-invalid"],
    ["main = 'c:x.js'", "main-path-invalid"],
    ["main = 7", "main-path-invalid"],
    ["version = '01.0.0'", "version-invalid"],
    ["version = 'v1.0.0'", "version-invalid"],
    ["api = 0.5", "api-unsupported"],
    ["api = '0'", "api-unsupported"],
    ["id = 'a'", "id-invalid"],
    ["id = '-ab'", "id-invalid"],
    [`id = ${JSON.stringify("a".repeat(40))}`, "id-invalid"],
    [`name = ${JSON.stringify("n".repeat(201))}`, "name-invalid"],
    [`description = ${JSON.stringify("d".repeat(1001))}`, "text-invalid"],
    ["author = 3", "text-invalid"],
    ["activation = ['onStartupFinished', 'later']", "activation-unknown"],
    ["activation = 'onStartupFinished'", "activation-unknown"],
    ["permissions = ['vault.delete']", "permission-unknown"],
    ["permissions = ['net']", "permission-reserved"],
    ["permissions = ['vault.read', 'vault.read']", "permission-duplicate"],
    ["permissions = 'vault.read'", "permission-invalid"],
    ["min_app = '1.2'", "min-app-invalid"],
    ["dev = 'yes'", "text-invalid"],
  ])("rejects %s", (line, code) => {
    const key = line.split("=")[0].trim();
    const text = `${
      base.replace(new RegExp(`^${key}\\s*=.*$`, "m"), "") + line
    }\n`;
    expect(codes(validateManifestText(text))).toContain(code);
  });

  it("flags a missing required key", () => {
    for (const key of ["id", "name", "version", "api", "main"]) {
      const text = base.replace(new RegExp(`^${key}\\s*=.*\\n`, "m"), "");
      const r = validateManifestText(text);
      expect(r.errors.map((e) => e.code)).toEqual(["missing-key"]);
      expect(r.errors[0].message).toContain(key);
    }
  });

  it("accepts prerelease and build versions", () => {
    expect(
      validateManifestText(base.replace("1.0.0", "1.0.0-beta.1+build.5"))
        .errors,
    ).toEqual([]);
  });

  it("checks contributions", () => {
    expect(
      codes(
        with_(
          "[[contributes.commands]]\nid = 'a'\ntitle = 'A'\n[[contributes.commands]]\nid = 'a'\ntitle = 'B'\n",
        ),
      ),
    ).toEqual(["contribution-duplicate"]);
    expect(
      codes(
        with_(
          "[[contributes.panels]]\nid = 'p'\ntitle = 'A'\n[[contributes.panels]]\nid = 'p'\ntitle = 'B'\n",
        ),
      ),
    ).toEqual(["contribution-duplicate"]);
    // the same id in a command and a panel is fine
    expect(
      with_(
        "[[contributes.commands]]\nid = 'p'\ntitle = 'A'\n[[contributes.panels]]\nid = 'p'\ntitle = 'B'\n",
      ).errors,
    ).toEqual([]);
    expect(
      codes(with_("[[contributes.panels]]\nid = '1p'\ntitle = 'A'\n")),
    ).toEqual(["contribution-id-invalid"]);
    expect(codes(with_("[[contributes.commands]]\ntitle = 'A'\n"))).toEqual([
      "missing-key",
    ]);
    expect(
      codes(with_("[[contributes.panels]]\nid = 'p'\ntitle = ''\n")),
    ).toEqual(["title-invalid"]);
    expect(
      codes(
        with_(
          "[[contributes.panels]]\nid = 'p'\ntitle = 'T'\ngroup = 'left'\n",
        ),
      ),
    ).toEqual(["contribution-invalid"]);
    expect(
      codes(
        with_(
          "[[contributes.commands]]\nid = 'p'\ntitle = 'T'\nkeys = 'Mod+K'\n",
        ),
      ),
    ).toEqual(["contribution-invalid"]);
    expect(
      codes(
        with_("[[contributes.commands]]\nid = 'p'\ntitle = 'T'\nextra = 1\n"),
      ),
    ).toEqual(["unknown-key"]);
    expect(codes(with_("[contributes]\nthings = 1\n"))).toEqual([
      "unknown-key",
    ]);
    expect(
      codes(with_("[[contributes.settings]]\nkey = 'k'\ntype = ''\n")),
    ).toEqual(["setting-invalid"]);
    expect(
      with_(
        "[[contributes.settings]]\nkey = 'k'\ntype = 'int'\nextra = [1, 2]\n",
      ).errors,
    ).toEqual([]);
  });

  it("enforces the contribution limits", () => {
    const n = (kind, count) =>
      Array.from(
        { length: count },
        (_, i) =>
          `[[contributes.${kind}]]\nid = "i${i}"\ntitle = "T"\nkey = "k${i}"\ntype = "int"\n`,
      ).join("");
    const settings = (count) =>
      Array.from(
        { length: count },
        (_, i) => `[[contributes.settings]]\nkey = "k${i}"\ntype = "int"\n`,
      ).join("");
    const commands = (count) =>
      Array.from(
        { length: count },
        (_, i) => `[[contributes.commands]]\nid = "c${i}"\ntitle = "T"\n`,
      ).join("");
    const panels = (count) =>
      Array.from(
        { length: count },
        (_, i) => `[[contributes.panels]]\nid = "p${i}"\ntitle = "T"\n`,
      ).join("");
    void n;
    expect(with_(commands(200)).errors).toEqual([]);
    expect(codes(with_(commands(201)))).toEqual(["too-many"]);
    expect(with_(panels(20)).errors).toEqual([]);
    expect(codes(with_(panels(21)))).toEqual(["too-many"]);
    expect(with_(settings(100)).errors).toEqual([]);
    expect(codes(with_(settings(101)))).toEqual(["too-many"]);
  });

  it("limits the size to 64 KB and reports only that", () => {
    const r = validateManifestText(`${base}# ${"x".repeat(64 * 1024)}\n`);
    expect(r.errors).toEqual([
      {
        code: "manifest-too-large",
        message: expect.any(String),
        file: "plugin.toml",
      },
    ]);
    expect(
      validateManifestText(`${base}# ${"x".repeat(60 * 1024)}\n`).errors,
    ).toEqual([]);
  });

  it("reports dev = true as an error but accepts dev = false", () => {
    expect(codes(with_("dev = true\n"))).toEqual(["dev-true"]);
    expect(with_("dev = false\n").errors).toEqual([]);
  });

  it("reports invalid TOML with the line", () => {
    const r = validateManifestText('id = "x\n');
    expect(codes(r)).toEqual(["toml-parse"]);
    expect(r.errors[0].message).toContain("line 1");
  });
});

describe("scanImports", () => {
  it("finds static, side-effect, dynamic and re-export imports", () => {
    const code = `
import a from "react";
import { b,
  c } from 'react-dom/client';
import * as d from "./d.js";
import "./side.js";
import type { T } from "@vaultdraw/api";
export * from "lodash";
export { x } from "../x.js";
const m = await import("chart.js");
const n = ctx.import("not-an-import");
`;
    expect(scanImports(code).sort()).toEqual(
      [
        "../x.js",
        "./d.js",
        "./side.js",
        "@vaultdraw/api",
        "chart.js",
        "lodash",
        "react",
        "react-dom/client",
      ].sort(),
    );
  });

  it("ignores comments and plain exports", () => {
    const code = `// import x from "nope";\n/* import y from "nope2"; */\nexport const a = "b";\nexport default { from: "c" };\n`;
    expect(scanImports(code)).toEqual([]);
  });

  it("ignores import and export words inside string and template literals", () => {
    const code = [
      `const a = "Couldn't write the export";`,
      `const b = 'the import "lodash" failed';`,
      'const c = `export from "chart.js"`;',
      // eslint-disable-next-line no-template-curly-in-string -- literal source text under test
      "const d = `${ok ? 'export' : \"import\"}`;",
      "const e = /import x from 'nope'/g;",
      'const f = a / 2 // export "nope3"',
      "const g = 'it\\'s export';",
    ].join("\n");
    expect(scanImports(code)).toEqual([]);
  });

  it("finds an import inside a template interpolation", () => {
    const code = [
      // eslint-disable-next-line no-template-curly-in-string -- literal source text under test
      'const a = `value ${await import("chart.js")} done`;',
      // eslint-disable-next-line no-template-curly-in-string -- literal source text under test
      'const b = `outer ${`inner ${import("deep.js")}`}`;',
    ].join("\n");
    expect(scanImports(code).sort()).toEqual(["chart.js", "deep.js"]);
  });

  it("ignores a plain string inside a template interpolation", () => {
    // eslint-disable-next-line no-template-curly-in-string -- literal source text under test
    const code = "const a = `value ${\"export * from 'lodash'\"} done`;\n";
    expect(scanImports(code)).toEqual([]);
  });

  it("still finds real imports next to literals that look like them", () => {
    const code = [
      `const msg = "Couldn't write the export";`,
      `import { z } from "lodash";`,
      `const url = "https://x.test/*not a comment*/";`,
      `const m = await import("chart.js");`,
      `export * from "react";`,
    ].join("\n");
    expect(scanImports(code).sort()).toEqual(
      ["chart.js", "lodash", "react"].sort(),
    );
  });
});

describe("checkPlugin", () => {
  const findings = (dir) => {
    const r = checkPlugin(dir);
    return { errors: codes(r), warnings: r.warnings.map((w) => w.code), r };
  };

  it("passes a good plugin with no findings", () => {
    const f = findings(makePlugin());
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([]);
    expect(f.r.ok).toBe(true);
  });

  it("reports a missing plugin.toml", () => {
    const dir = makePlugin();
    const empty = write(path.join(dir, "empty"), { "x.txt": "" });
    expect(findings(empty).errors).toEqual(["plugin-toml-missing"]);
  });

  it("reports a missing main file", () => {
    const dir = makePlugin();
    const r = findings(
      write(dir, {
        "plugin.toml": MANIFEST.replace("main.js", "src/entry.js"),
      }),
    );
    expect(r.errors).toEqual(["main-missing"]);
    expect(r.r.errors[0].file).toBe("src/entry.js");
  });

  it("reports imports the app does not provide", () => {
    const dir = makePlugin({
      "main.js": 'import _ from "lodash";\nimport { x } from "./util.js";\n',
      "util.js": 'import "chart.js";\nexport const x = 1;\n',
    });
    const r = findings(dir);
    expect(r.errors).toEqual(["imports-unshared", "imports-unshared"]);
    expect(r.r.errors.map((e) => e.file).sort()).toEqual([
      "main.js",
      "util.js",
    ]);
  });

  it("accepts a message that ends in the word export", () => {
    const dir = makePlugin({
      "main.js":
        'export default { activate(ctx) { ctx.notify("Couldn\'t write the export"); } };\n',
    });
    expect(findings(dir).errors).toEqual([]);
  });

  it("still rejects a real export from or dynamic import of an unshared module", () => {
    const dir = makePlugin({
      "main.js":
        'import "./util.js";\nexport * from "lodash";\nexport default { x: 1 };\n',
      "util.js": 'export const y = await import("chart.js");\n',
    });
    expect(findings(dir).errors).toEqual([
      "imports-unshared",
      "imports-unshared",
    ]);
  });

  it("accepts the shared specifiers", () => {
    const code = SHARED_SPECIFIERS.map(
      (s, i) => `import * as m${i} from "${s}";`,
    ).join("\n");
    expect(findings(makePlugin({ "main.js": code })).errors).toEqual([]);
  });

  it("warns about a relative import that does not exist", () => {
    const f = findings(makePlugin({ "main.js": 'import "./gone.js";\n' }));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual(["import-missing"]);
  });

  it("warns about a large bundle and a missing README", () => {
    const f = findings(
      makePlugin({
        "main.js": `export default {};\n// ${"x".repeat(101 * 1024)}\n`,
        "README.md": null,
      }),
    );
    expect(f.warnings.sort()).toEqual(["bundle-large", "readme-missing"]);
  });

  it("warns when min_app is lower than the app that shipped the API in use", () => {
    const code =
      'export default { activate(ctx) { ctx.commands.register("a", () => {}); } };\n';
    const toml = `${MANIFEST}min_app = "0.1.0"\n`;
    expect(
      findings(makePlugin({ "main.js": code, "plugin.toml": toml })).warnings,
    ).toEqual(["min-app-low"]);
    // no ctx use, or a high enough min_app: no warning
    expect(
      findings(
        makePlugin({ "plugin.toml": toml, "main.js": "export default {};\n" }),
      ).warnings,
    ).toEqual([]);
    expect(
      findings(
        makePlugin({
          "main.js": code,
          "plugin.toml": `${MANIFEST}min_app = "0.1.2"\n`,
        }),
      ).warnings,
    ).toEqual([]);
    expect(findings(makePlugin({ "main.js": code })).warnings).toEqual([]);
  });

  it("never fails on warnings alone", () => {
    expect(checkPlugin(makePlugin({ "README.md": null })).ok).toBe(true);
  });

  it("keeps the shared list equal to the SDK and the app", async () => {
    const sdk = readFileSync(
      path.join(SDK, "api", "src", "specifiers.ts"),
      "utf8",
    );
    const fromSdk = [...sdk.matchAll(/^\s+"([^"]+)",$/gm)].map((m) => m[1]);
    expect(SHARED_SPECIFIERS).toEqual(fromSdk);
    const app = readFileSync(
      path.join(REPO, "excalidraw-desktop/src/plugins/shared/specifiers.ts"),
      "utf8",
    );
    const fromApp = [...app.matchAll(/specifier:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect([...SHARED_SPECIFIERS].sort()).toEqual([...fromApp].sort());
  });

  it("keeps the first-app revision equal to sdk/api/package.json", async () => {
    const { API_AREAS } = await import("../src/check.mjs");
    const pkg = JSON.parse(
      readFileSync(path.join(SDK, "api", "package.json"), "utf8"),
    );
    expect(API_AREAS.every(([, v]) => v === pkg.vaultdraw.minApp)).toBe(true);
  });
});

describe("command line: check", () => {
  it("prints text and exits 0 for a good plugin", () => {
    const r = run(["check", makePlugin()]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("no problems found");
  });

  it("exits 1 with a readable line per finding", () => {
    const dir = makePlugin({ "main.js": 'import "lodash";\n' });
    const r = run(["check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^error: .*\[imports-unshared\] \(main\.js\)$/m);
    expect(r.out).toContain("1 error, 0 warnings");
    expect(r.err).toBe("");
  });

  it("prints exactly the documented JSON", () => {
    const dir = makePlugin({
      "main.js": 'import "lodash";\n',
      "README.md": null,
    });
    const r = run(["check", dir, "--json"]);
    expect(r.code).toBe(1);
    const j = JSON.parse(r.out);
    expect(Object.keys(j)).toEqual([
      "schemaVersion",
      "ok",
      "errors",
      "warnings",
    ]);
    expect(j.schemaVersion).toBe(1);
    expect(j.ok).toBe(false);
    expect(Object.keys(j.errors[0])).toEqual(["code", "message", "file"]);
    expect(j.errors[0].code).toBe("imports-unshared");
    expect(j.warnings.map((w) => w.code)).toEqual(["readme-missing"]);
    const ok = JSON.parse(run(["check", makePlugin(), "--json"]).out);
    expect(ok).toEqual({
      schemaVersion: 1,
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it("exits 2 for a missing folder or missing argument", () => {
    expect(run(["check", path.join(makePlugin(), "nope")]).code).toBe(2);
    const r = run(["check"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Missing the plugin folder");
  });
});
