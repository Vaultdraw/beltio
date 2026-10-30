import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkPlugin } from "../src/check.mjs";
import { validateManifestText } from "../src/manifest.mjs";

import { cleanup, makePlugin, MANIFEST, run, SDK, tmp } from "./helpers.mjs";

afterAll(cleanup);

// Hunter M (2026-10-30 night), plugin developer experience against API 1.0.
// The app refuses a plugin whose min_api is newer than the API revision it implements
// (`manifest.rs compatibility`, API_REVISION = sdk/api/package.json version), but
// `vaultdraw-plugin check` says "no problems found", so the author ships a plugin no app loads.
// Reference: Zed's extension tooling and Neovim's `has('nvim-0.x')` tell the author which
// version the code needs; the check tool is the twin of the app's loader and should agree.

const REVISION = JSON.parse(
  readFileSync(path.join(SDK, "api", "package.json"), "utf8"),
).version;
const findings = (text) => {
  const r = validateManifestText(text);
  return [...r.errors, ...r.warnings].map((f) => f.code);
};

describe("min_api against the API revision this SDK implements (toimprove M-4)", () => {
  it("sanity: the revision is 1.0.0 and min_api equal to it is clean", () => {
    expect(REVISION).toBe("1.0.0");
    expect(findings(`${MANIFEST}min_api = "${REVISION}"\n`)).toEqual([]);
  });

  for (const v of ["1.5.0", "2.0.0"]) {
    it.fails(
      `min_api = "${v}" (newer than ${REVISION}) is reported, as the app refuses it`,
      () => {
        expect(findings(`${MANIFEST}min_api = "${v}"\n`)).not.toEqual([]);
      },
    );
  }
});

// toimprove M-7: stability.md "Deprecation" step 2 says `vaultdraw-plugin check` warns where it can
// see the use of a deprecated name. Only `api = 0` is warned; a plain `{ action: … }` toast option
// or `ctx.manifest.dir` in main.js passes as "no problems found". The scan for imports
// (`check.mjs scanImports`) already reads the code, so the uses are visible to it.
describe("check warns on deprecated names in the code (toimprove M-7)", () => {
  const code = (body) =>
    `import { definePlugin } from "@vaultdraw/api";\nexport default definePlugin({ activate(ctx) {\n${body}\n} });\n`;

  it("sanity: clean code has no warnings", () => {
    expect(
      checkPlugin(makePlugin({ "main.js": code('ctx.ui.toast("hi");') }))
        .warnings,
    ).toEqual([]);
  });

  for (const [what, body] of [
    [
      "ToastOptions.action",
      'ctx.ui.toast("Saved", { action: { label: "Undo", run: () => {} } });',
    ],
    ["ctx.manifest.dir", "ctx.log.info(ctx.manifest.dir);"],
  ]) {
    it.fails(`${what} in main.js gets a deprecation warning`, () => {
      const r = checkPlugin(makePlugin({ "main.js": code(body) }));
      expect(r.warnings.length).toBeGreaterThan(0);
    });
  }
});

// toimprove M-8: the TypeScript templates' package.json runs `vaultdraw-plugin` in every script
// (dev, build, check, package), and the generated README says `npm run dev` / `npm run build`
// work after `npm install`. The tool is not on npm (getting-started.md: "Not on npm yet") and is
// not a devDependency, so after `npm install` every script fails "vaultdraw-plugin: command not
// found" (seen in a fresh `npm create`-style scaffold, 2026-10-30). Reference: Obsidian's sample
// plugin and Zed's extension template run their build with tools `npm install` brings.
describe("template scripts run after npm install (toimprove M-8)", () => {
  for (const template of ["command", "panel", "scene"]) {
    it.fails(`${template}: every script's tool is installed by npm install`, () => {
      const parent = tmp("vdp-huntm-");
      const r = run(["init", "demo-tpl", "--template", template, "--dir", parent]);
      expect(r.code).toBe(0);
      const pkg = JSON.parse(
        readFileSync(path.join(parent, "demo-tpl", "package.json"), "utf8"),
      );
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const uses = Object.values(pkg.scripts).some((s) =>
        /^vaultdraw-plugin\b/.test(s),
      );
      expect(uses).toBe(true);
      expect(Object.keys(deps)).toContain("vaultdraw-plugin");
    });
  }
});

// toimprove M-9: getting-started.md sets `VP="node /path/…/vaultdraw-plugin.mjs"` and runs `$VP init`.
// zsh, the default shell on macOS (the only platform the doc says is tested), does not split an
// unquoted variable, so the very first command fails "no such file or directory: node /path/…".
// The same page still shows the old message "this version of the app implements 0".
describe("getting-started works as written on macOS (toimprove M-9)", () => {
  const doc = readFileSync(path.join(SDK, "docs", "getting-started.md"), "utf8");
  it.fails("no command depends on word-splitting a shell variable", () => {
    expect(doc).not.toMatch(/^\$VP /m);
  });
  it.fails("the api-unsupported example matches what check prints today (implements 1)", () => {
    expect(doc).not.toContain("this version of the app implements 0");
  });
});
