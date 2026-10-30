import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkPlugin } from "../src/check.mjs";
import { rewriteManifest, titleCase, wrapApiTypes } from "../src/init.mjs";

import { cleanup, REPO, run, SDK, tmp, write } from "./helpers.mjs";

afterAll(cleanup);

describe("init helpers", () => {
  it("makes a Title Case name from the id", () => {
    expect(titleCase("my-cool-plugin")).toBe("My Cool Plugin");
    expect(titleCase("hello")).toBe("Hello");
    expect(titleCase("a1-b2")).toBe("A1 B2");
  });

  it("rewrites only the top-level keys and drops the author", () => {
    const text =
      'id = "x"\nname = "X"\nversion = "9.9.9"\napi = 1\nmain = "main.js"\ndescription = "old"\nauthor = "me"\n\n[[contributes.commands]]\nid = "x"\ntitle = "Keep"\nauthor = "keep"\n';
    expect(rewriteManifest(text, "new-one")).toBe(
      'id = "new-one"\nname = "New One"\nversion = "0.1.0"\napi = 1\nmain = "main.js"\ndescription = "A Vaultdraw plugin."\n\n[[contributes.commands]]\nid = "x"\ntitle = "Keep"\nauthor = "keep"\n',
    );
  });

  it("wraps the API surface in a module declaration without relative imports", () => {
    const surface = readFileSync(
      path.join(SDK, "api", "etc", "api-surface.d.ts"),
      "utf8",
    );
    const d = wrapApiTypes(surface);
    expect(d).toContain('declare module "@vaultdraw/api" {');
    expect(d).not.toMatch(/from "\.\//);
    expect(d).not.toMatch(/^(import|export) /m); // everything sits inside the block, indented
    expect(d).toContain("export declare const definePlugin");
    expect(d.trimEnd().endsWith("}")).toBe(true);
  });
});

describe("command line: init", () => {
  it.each(["hello-command", "focus-timer", "stamp"])(
    "creates a plugin from %s that passes check",
    (example) => {
      const parent = tmp();
      const r = run([
        "init",
        "my-plugin",
        "--example",
        example,
        "--dir",
        parent,
      ]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      const dir = path.join(parent, "my-plugin");
      const names = readdirSync(dir).sort();
      expect(names).toEqual([
        "README.md",
        "jsconfig.json",
        "main.js",
        "plugin.toml",
        "vaultdraw-api.d.ts",
      ]);
      const toml = readFileSync(path.join(dir, "plugin.toml"), "utf8");
      expect(toml).toMatch(/^id = "my-plugin"$/m);
      expect(toml).toMatch(/^name = "My Plugin"$/m);
      expect(toml).toMatch(/^version = "0\.1\.0"$/m);
      expect(toml).not.toMatch(/^author/m);
      expect(toml).not.toMatch(/dev/);
      const c = checkPlugin(dir);
      expect(c.errors).toEqual([]);
      expect(c.warnings).toEqual([]);
      expect(r.out).toContain("cd ");
      expect(r.out).toContain("vaultdraw-plugin dev .");
    },
  );

  it("uses hello-command by default and the current folder when --dir is missing", () => {
    const parent = tmp();
    const r = run(["init", "plain-one"], { cwd: parent });
    expect(r.code).toBe(0);
    expect(r.out).toContain("cd plain-one");
    expect(
      readFileSync(path.join(parent, "plain-one", "main.js"), "utf8"),
    ).toContain("hello");
  });

  it("copies no test files", () => {
    const parent = tmp();
    for (const e of ["hello-command", "focus-timer", "stamp"]) {
      expect(
        run(["init", `p-${e}`, "--example", e, "--dir", parent]).code,
      ).toBe(0);
      expect(
        readdirSync(path.join(parent, `p-${e}`)).filter((f) =>
          f.includes(".test."),
        ),
      ).toEqual([]);
    }
  });

  it.each([
    "A",
    "a",
    "-ab",
    "has space",
    "under_score",
    "x".repeat(40),
    "../evil",
  ])("refuses the id %j", (id) => {
    const parent = tmp();
    const r = run(["init", "--dir", parent, "--", id]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not a valid plugin id");
    expect(readdirSync(parent)).toEqual([]);
  });

  it("refuses an existing non-empty folder and leaves it alone", () => {
    const parent = tmp();
    write(parent, { "taken/keep.txt": "mine" });
    const r = run(["init", "taken", "--dir", parent]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("already exists");
    expect(readdirSync(path.join(parent, "taken"))).toEqual(["keep.txt"]);
  });

  it("accepts an existing empty folder", () => {
    const parent = tmp();
    mkdirSync(path.join(parent, "empty-one"));
    expect(run(["init", "empty-one", "--dir", parent]).code).toBe(0);
    expect(existsSync(path.join(parent, "empty-one", "plugin.toml"))).toBe(
      true,
    );
  });

  it("refuses an unknown example and a missing parent folder", () => {
    const parent = tmp();
    expect(
      run(["init", "ok-id", "--example", "nope", "--dir", parent]).code,
    ).toBe(2);
    expect(
      run(["init", "ok-id", "--dir", path.join(parent, "missing")]).code,
    ).toBe(2);
  });

  it("touches nothing outside the new folder", () => {
    const parent = tmp();
    write(parent, { "other/file.txt": "x" });
    run(["init", "fresh-one", "--dir", parent]);
    expect(readdirSync(parent).sort()).toEqual(["fresh-one", "other"]);
    expect(readdirSync(path.join(parent, "other"))).toEqual(["file.txt"]);
  });

  it.each(["hello-command", "focus-timer", "stamp"])(
    "makes a %s project that the TypeScript checker accepts",
    (example) => {
      const parent = tmp();
      expect(
        run(["init", "typed-one", "--example", example, "--dir", parent]).code,
      ).toBe(0);
      const dir = path.join(parent, "typed-one");
      // Editors find react's types by walking up to a node_modules folder.
      symlinkSync(
        path.join(REPO, "node_modules"),
        path.join(parent, "node_modules"),
      );
      const tsc = path.join(REPO, "node_modules", "typescript", "bin", "tsc");
      const r = spawnSync(
        process.execPath,
        [tsc, "-p", "jsconfig.json", "--noEmit", "--skipLibCheck"],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 120000,
        },
      );
      expect(r.stdout + r.stderr).toBe("");
      expect(r.status).toBe(0);
    },
    240000,
  );
});
