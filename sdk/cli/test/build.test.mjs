import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findEntry, isBuildProject } from "../src/build.mjs";

import { cleanup, run, SDK, start, tmp, waitFor, write } from "./helpers.mjs";

afterAll(cleanup);

const TEMPLATES = ["command", "panel", "scene"];
const init = (template, id = "my-plugin", parent = tmp()) => {
  const r = run(["init", id, "--template", template, "--dir", parent]);
  return { ...r, dir: path.join(parent, id) };
};
const tree = (dir) => {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      e.isDirectory() ? walk(r) : out.push(r);
    }
  };
  walk("");
  return out.sort();
};

describe("init --template", () => {
  it.each(TEMPLATES)(
    "%s: creates the project files with the id and name filled in",
    (t) => {
      const r = init(t, "my-cool-plugin");
      expect(r.code).toBe(0);
      const files = tree(r.dir);
      const main = t === "panel" ? "src/main.tsx" : "src/main.ts";
      for (const f of [
        ".gitignore",
        "README.md",
        "package.json",
        "plugin.toml",
        "tsconfig.json",
        "vitest.config.ts",
        main,
        "src/main.test.ts",
        "vaultdraw/vaultdraw-api.d.ts",
      ]) {
        expect(files).toContain(f);
      }
      expect(files.some((f) => f.endsWith(".tpl"))).toBe(false);
      for (const f of files.filter((f) => !f.startsWith("vaultdraw/"))) {
        const text = readFileSync(path.join(r.dir, f), "utf8");
        expect(text, f).not.toMatch(/__ID__|__NAME__/);
      }
      const toml = readFileSync(path.join(r.dir, "plugin.toml"), "utf8");
      expect(toml).toMatch(/^id = "my-cool-plugin"$/m);
      expect(toml).toMatch(/^name = "My Cool Plugin"$/m);
      expect(toml).toMatch(/^version = "0.1.0"$/m);
      expect(toml).not.toMatch(/^author/m);
      const pkg = JSON.parse(
        readFileSync(path.join(r.dir, "package.json"), "utf8"),
      );
      expect(pkg).toMatchObject({
        name: "my-cool-plugin",
        type: "module",
        private: true,
      });
      expect(pkg.scripts).toEqual({
        dev: "vaultdraw-plugin dev .",
        build: "vaultdraw-plugin build",
        check: "vaultdraw-plugin check dist",
        test: "vitest run",
        package: "vaultdraw-plugin package dist",
      });
      expect(pkg.devDependencies.esbuild).toBe("^0.25.0");
      expect(Boolean(pkg.devDependencies["@testing-library/react"])).toBe(
        t !== "command",
      );
      const tsconfig = JSON.parse(
        readFileSync(path.join(r.dir, "tsconfig.json"), "utf8"),
      );
      expect(tsconfig.compilerOptions.paths["@vaultdraw/api/testing"]).toEqual([
        "./vaultdraw/testing/index.ts",
      ]);
    },
  );

  it("main files import only types from @vaultdraw/api", () => {
    for (const t of TEMPLATES) {
      const r = init(t);
      const main = readFileSync(
        path.join(r.dir, t === "panel" ? "src/main.tsx" : "src/main.ts"),
        "utf8",
      );
      const apiImports = main.match(/^import .*"@vaultdraw\/api".*$/gm) ?? [];
      expect(apiImports.length).toBeGreaterThan(0);
      for (const l of apiImports) {
        expect(l).toMatch(/^import type /);
      }
    }
  });

  it("ships the schema and points plugin.toml at it", () => {
    const r = init("command");
    expect(
      existsSync(path.join(r.dir, "vaultdraw", "plugin.schema.json")),
    ).toBe(true);
    expect(readFileSync(path.join(r.dir, "plugin.toml"), "utf8")).toMatch(
      /^#:schema \.\/vaultdraw\/plugin\.schema\.json\n/,
    );
  });

  it("vendors the test kit (tests of the kit stay behind)", () => {
    const r = init("command");
    const files = tree(r.dir).filter((f) => f.startsWith("vaultdraw/testing/"));
    expect(files).toContain("vaultdraw/testing/index.ts");
    expect(files.length).toBe(
      readdirSync(path.join(SDK, "api", "testing")).filter(
        (f) => !/\.test\./.test(f),
      ).length,
    );
    expect(files.some((f) => /\.test\./.test(f))).toBe(false);
  });

  it("rejects an invalid id, an unknown template and --template with --example", () => {
    const parent = tmp();
    const bad = run([
      "init",
      "Bad_Id",
      "--template",
      "command",
      "--dir",
      parent,
    ]);
    expect(bad.code).toBe(2);
    expect(bad.err).toMatch(/not a valid plugin id/);
    const unknown = run([
      "init",
      "ok-id",
      "--template",
      "nope",
      "--dir",
      parent,
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toMatch(/command, panel, scene/);
    const both = run([
      "init",
      "ok-id",
      "--template",
      "command",
      "--example",
      "stamp",
      "--dir",
      parent,
    ]);
    expect(both.code).toBe(2);
    expect(both.err).toMatch(/not both/);
    expect(readdirSync(parent)).toEqual([]);
  });

  it("refuses a folder that is not empty", () => {
    const parent = tmp();
    write(parent, { "my-plugin/keep.txt": "x" });
    const r = run([
      "init",
      "my-plugin",
      "--template",
      "command",
      "--dir",
      parent,
    ]);
    expect(r.code).toBe(2);
  });

  it("the default stays the JavaScript example", () => {
    const parent = tmp();
    expect(run(["init", "my-plugin", "--dir", parent]).code).toBe(0);
    expect(existsSync(path.join(parent, "my-plugin", "main.js"))).toBe(true);
    expect(existsSync(path.join(parent, "my-plugin", "src"))).toBe(false);
  });
});

describe("build", () => {
  it.each(TEMPLATES)("%s: builds, and dist passes check and package", (t) => {
    const { dir } = init(t, "built-one");
    const b = run(["build"], { cwd: dir });
    expect(b.code, b.err).toBe(0);
    expect(b.out).toMatch(/dist\/main\.js \d+\.\d KB/);
    expect(tree(path.join(dir, "dist"))).toEqual([
      "README.md",
      "main.js",
      "plugin.toml",
    ]);
    expect(readFileSync(path.join(dir, "dist", "plugin.toml"), "utf8")).toBe(
      readFileSync(path.join(dir, "plugin.toml"), "utf8"),
    );
    const bundle = readFileSync(path.join(dir, "dist", "main.js"), "utf8");
    expect(bundle).toMatch(/^export default |export \{/m);
    expect(bundle).not.toMatch(/\/\/# sourceMappingURL/);
    const c = run(["check", "dist"], { cwd: dir });
    expect(c.code, c.out).toBe(0);
    expect(c.out).toMatch(/no problems/);
    const out = tmp();
    const p = run(["package", "dist", "--out", out], { cwd: dir });
    expect(p.code, p.err).toBe(0);
    expect(existsSync(path.join(out, "built-one-0.1.0.zip"))).toBe(true);
    expect(run(["check", path.join(out, "built-one-0.1.0.zip")]).code).toBe(0);
  });

  it("check on the project root points at build", () => {
    const { dir } = init("command", "root-check");
    const c = run(["check", "."], { cwd: dir, env: {} });
    expect(c.code).toBe(1);
    expect(c.out + c.err).toMatch(
      /main\.js not found: run `vaultdraw-plugin build` first \(or check dist\/\)/,
    );
  });

  it("package on the project root uses dist/ after a build", () => {
    const { dir } = init("scene", "root-pack");
    expect(run(["build"], { cwd: dir }).code).toBe(0);
    const out = tmp();
    const p = run(["package", ".", "--out", out], { cwd: dir });
    expect(p.code, p.err).toBe(0);
  });

  it("bundles an unknown bare module, which check then rejects", () => {
    const { dir } = init("command", "bundles");
    // `is-odd`-style: a package inside the project's node_modules
    write(dir, {
      "node_modules/tiny-dep/package.json":
        '{"name":"tiny-dep","main":"index.js"}',
      "node_modules/tiny-dep/index.js": "module.exports = 42;\n",
    });
    writeFileSync(
      path.join(dir, "src", "main.ts"),
      'import tiny from "tiny-dep";\nimport type { Plugin } from "@vaultdraw/api";\nconst p: Plugin = { activate(ctx) { ctx.ui.toast(String(tiny)); } };\nexport default p;\n',
    );
    expect(run(["build"], { cwd: dir }).code).toBe(0);
    const bundle = readFileSync(path.join(dir, "dist", "main.js"), "utf8");
    expect(bundle).toContain("42");
    expect(bundle).not.toMatch(/from "tiny-dep"/);
    expect(run(["check", "dist"], { cwd: dir }).code).toBe(0);
  });

  it("keeps shared specifiers external", () => {
    const { dir } = init("panel", "externals");
    expect(run(["build"], { cwd: dir }).code).toBe(0);
    const bundle = readFileSync(path.join(dir, "dist", "main.js"), "utf8");
    expect(bundle).toMatch(/from "react"/);
    expect(bundle).toMatch(/from "react\/jsx-runtime"/);
  });

  it("warns when the bundle is over 100 KB", () => {
    const { dir } = init("command", "big-one");
    writeFileSync(
      path.join(dir, "src", "main.ts"),
      `import type { Plugin } from "@vaultdraw/api";\nconst blob = ${JSON.stringify(
        "x".repeat(120_000),
      )};\nconst p: Plugin = { activate(ctx) { ctx.ui.toast(blob.slice(0, 3)); } };\nexport default p;\n`,
    );
    const b = run(["build"], { cwd: dir });
    expect(b.code).toBe(0);
    expect(b.err).toMatch(/over 100 KB/);
  });

  it("fails with exit 1 and a message on a syntax error", () => {
    const { dir } = init("command", "broken");
    writeFileSync(path.join(dir, "src", "main.ts"), "export default {{{\n");
    const b = run(["build"], { cwd: dir });
    expect(b.code).toBe(1);
    expect(b.err).toMatch(/error/i);
  });

  it("honours [x-build] entry", () => {
    const { dir } = init("command", "custom-entry");
    const text = readFileSync(path.join(dir, "src", "main.ts"), "utf8");
    mkdirSync(path.join(dir, "code"));
    writeFileSync(path.join(dir, "code", "start.ts"), text);
    const toml = path.join(dir, "plugin.toml");
    writeFileSync(
      toml,
      `${readFileSync(toml, "utf8")}\n[x-build]\nentry = "code/start.ts"\n`,
    );
    expect(findEntry(dir)).toBe("code/start.ts");
    expect(run(["check", "."], { cwd: dir }).out).not.toMatch(/unknown-key/);
    const b = run(["build"], { cwd: dir });
    expect(b.code, b.err).toBe(0);
  });

  it("says so when there is no entry", () => {
    const dir = tmp();
    write(dir, {
      "plugin.toml":
        'id = "no-src"\nname = "N"\nversion = "1.0.0"\napi = 1\nmain = "main.js"\n',
    });
    const b = run(["build"], { cwd: dir });
    expect(b.code).toBe(1);
    expect(b.err).toMatch(/No source entry/);
  });

  it("isBuildProject leaves plain-JavaScript folders alone", () => {
    const dir = tmp();
    write(dir, {
      "plugin.toml":
        'id = "plain"\nname = "P"\nversion = "1.0.0"\napi = 1\nmain = "src/main.js"\n',
      "src/main.js": "export default {}\n",
    });
    expect(isBuildProject(dir)).toBe(false);
    const ts = init("command", "is-ts");
    expect(isBuildProject(ts.dir)).toBe(true);
  });

  it("--watch rebuilds on a change and prints a line per rebuild", async () => {
    const { dir } = init("command", "watching");
    const w = start(["build", "--watch"], { cwd: dir });
    try {
      await waitFor(() => /Watching/.test(w.output()), 15000);
      expect(existsSync(path.join(dir, "dist", "main.js"))).toBe(true);
      const f = path.join(dir, "src", "main.ts");
      writeFileSync(
        f,
        `${readFileSync(f, "utf8")}\nexport const marker = "changed-marker";\n`,
      );
      await waitFor(() => /rebuilt/.test(w.output()), 15000);
      expect(readFileSync(path.join(dir, "dist", "main.js"), "utf8")).toContain(
        "changed-marker",
      );
      writeFileSync(
        path.join(dir, "plugin.toml"),
        readFileSync(path.join(dir, "plugin.toml"), "utf8").replace(
          "A Vaultdraw plugin.",
          "Edited.",
        ),
      );
      await waitFor(
        () =>
          /Edited\./.test(
            readFileSync(path.join(dir, "dist", "plugin.toml"), "utf8"),
          ),
        15000,
      );
    } finally {
      await w.stop();
    }
  }, 40000);
});

describe("dev with a TypeScript project", () => {
  it("builds and mirrors dist/ into the plugins folder (--once)", () => {
    const { dir } = init("command", "dev-ts");
    const config = tmp("vdp-app-");
    mkdirSync(path.join(config, "plugins"));
    const r = run(["dev", dir, "--config-dir", config, "--once"]);
    expect(r.code, r.err).toBe(0);
    const installed = path.join(config, "plugins", "dev-ts");
    expect(tree(installed)).toEqual(["README.md", "main.js", "plugin.toml"]);
    expect(readFileSync(path.join(installed, "plugin.toml"), "utf8")).toMatch(
      /^dev = true$/m,
    );
  });

  it("watch mode rebuilds and re-copies on a source change", async () => {
    const { dir } = init("command", "dev-ts2");
    const config = tmp("vdp-app-");
    mkdirSync(path.join(config, "plugins"));
    const d = start(["dev", dir, "--config-dir", config]);
    try {
      await waitFor(() => /Watching/.test(d.output()), 15000);
      const installed = path.join(config, "plugins", "dev-ts2", "main.js");
      expect(existsSync(installed)).toBe(true);
      const f = path.join(dir, "src", "main.ts");
      writeFileSync(
        f,
        `${readFileSync(f, "utf8")}\nexport const marker = "edit-marker";\n`,
      );
      await waitFor(
        () => /edit-marker/.test(readFileSync(installed, "utf8")),
        15000,
      );
    } finally {
      await d.stop();
    }
  }, 40000);
});

describe("help", () => {
  it("lists the new commands and options", () => {
    const r = run(["--help"]);
    expect(r.out).toMatch(/build \[dir\] \[--watch\]/);
    expect(r.out).toMatch(/package <dir> \[--out <dir>\] \[--json\]/);
    expect(r.out).toMatch(/--template command\|panel\|scene/);
    expect(r.out).toMatch(/file\.zip/);
  });

  it("answers usage errors with exit 2", () => {
    expect(run(["package", "--bogus"]).code).toBe(2);
    expect(run(["build", "a", "b"]).code).toBe(2);
    expect(run(["build", "/no/such/folder"]).code).toBe(2);
  });
});
