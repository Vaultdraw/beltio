import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cleanup, run, SDK, tmp, write } from "./helpers.mjs";

afterAll(cleanup);

const manifest = (extra = "") => `id = "demo-plugin"
name = "Demo"
version = "1.0.0"
api = 0
main = "main.js"
${extra}`;
const cmd = (id) => `\n[[contributes.commands]]\nid = "${id}"\ntitle = "Demo ${id}"\n`;
const panel = (id) => `\n[[contributes.panels]]\nid = "${id}"\ntitle = "Panel ${id}"\n`;

const plugin = (files) => {
  const dir = tmp("vdp-act-");
  write(dir, { "README.md": "# Demo\n", ...files });
  return dir;
};
const act = (dir, ...extra) => run(["check", dir, "--activate", ...extra]);
const codes = (r) => JSON.parse(r.out).errors.map((e) => e.code);

const OK = `import { definePlugin } from "@vaultdraw/api";
export default definePlugin({
  activate(ctx) {
    ctx.commands.register("hello", () => ctx.ui.toast("hi"));
  },
});
`;

describe("check --activate", () => {
  it("passes the shipped examples and reports what was bound", () => {
    for (const [name, text] of [
      ["hello-command", "1 command and 0 panels"],
      ["focus-timer", "2 commands and 1 panel"],
      ["stamp", "2 commands and 0 panels"],
    ]) {
      const r = act(path.join(SDK, "examples", name));
      expect(r.code, r.out + r.err).toBe(0);
      expect(r.out).toContain(`bound ${text}`);
    }
  });

  it("passes a plain plugin and gives JSON with the bound ids", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": OK,
    });
    const r = act(dir, "--json");
    expect(r.code, r.out).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.schemaVersion).toBe(1);
    expect(j.activation.commands).toEqual(["hello"]);
    expect(j.activation.panels).toEqual([]);
  });

  it("does not run any plugin code without --activate", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `import { definePlugin } from "@vaultdraw/api";\nthrow new Error("ran");\nexport default definePlugin({ activate() {} });\n`,
    });
    const r = run(["check", dir]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain("ran");
    expect(act(dir, "--json").code).toBe(1);
  });

  it("skips the activation when the static checks fail", () => {
    const dir = plugin({ "plugin.toml": manifest("bogus = 1\n"), "main.js": OK });
    const r = act(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Activation: skipped");
  });

  it("flags a declared command that is never bound", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello") + cmd("other")),
      "main.js": OK,
    });
    const r = act(dir, "--json");
    expect(r.code).toBe(1);
    expect(codes(r)).toEqual(["activate-unbound-command"]);
    expect(JSON.parse(r.out).errors[0].message).toContain("'other'");
  });

  it("flags a declared panel that is never registered", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello") + panel("side")),
      "main.js": OK,
    });
    expect(codes(act(dir, "--json"))).toEqual(["activate-unbound-panel"]);
  });

  it("flags a command or panel that is bound but not declared", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `import { definePlugin } from "@vaultdraw/api";
export default definePlugin({
  activate(ctx) {
    ctx.commands.register("hello", () => {});
    ctx.commands.register("ghost", () => {});
    ctx.panels.register("nowhere", () => null);
  },
});
`,
    });
    expect(codes(act(dir, "--json")).sort()).toEqual([
      "activate-undeclared-command",
      "activate-undeclared-panel",
    ]);
  });

  it("flags an event name the app does not have", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": OK.replace(
        'ctx.commands.register("hello"',
        'ctx.events.on("drawing.exploded", () => {});\n    ctx.commands.register("hello"',
      ),
    });
    const r = act(dir, "--json");
    expect(codes(r)).toEqual(["activate-unknown-event"]);
  });

  it("reports an error thrown in activate in plain words", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `export default { activate() { throw new Error("boom"); } };\n`,
    });
    const r = act(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("activate() threw: boom");
  });

  it("reports a load failure, a missing default export and a syntax error", () => {
    const manifestText = manifest(cmd("hello"));
    const cases = [
      [`throw new Error("bad top level");\nexport default {};\n`, "activate-load-failed"],
      [`export const x = 1;\n`, "activate-no-default"],
      [`export default { activate: 3 };\n`, "activate-no-default"],
      [`export default {{{\n`, "activate-load-failed"],
    ];
    for (const [main, code] of cases) {
      const dir = plugin({ "plugin.toml": manifestText, "main.js": main });
      expect(codes(act(dir, "--json")), main).toContain(code);
    }
  });

  it("ends a plugin that never finishes, with a plain message", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `export default { activate() { return new Promise(() => { setInterval(() => {}, 1000); }); } };\n`,
    });
    const t = Date.now();
    const r = act(dir, "--timeout", "600", "--json");
    expect(Date.now() - t).toBeLessThan(10000);
    expect(r.code).toBe(1);
    expect(codes(r)).toEqual(["activate-timeout"]);
    expect(JSON.parse(r.out).errors[0].message).toContain("600 ms");
  });

  it("ends a plugin that loops forever", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `export default { activate() { for (;;) {} } };\n`,
    });
    const r = act(dir, "--timeout", "500", "--json");
    expect(codes(r)).toEqual(["activate-timeout"]);
  });

  it("warns, but does not fail, when the plugin needs the running app", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": OK.replace(
        'ctx.commands.register("hello"',
        "ctx.scene.getElements();\n    ctx.commands.register(\"hello\"",
      ),
    });
    const r = act(dir, "--json");
    expect(r.code, r.out).toBe(0);
    expect(JSON.parse(r.out).warnings.map((w) => w.code)).toContain(
      "activate-unsupported",
    );
  });

  it("loads relative modules and ESM without a package.json type", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `import { definePlugin } from "@vaultdraw/api";\nimport { id } from "./lib/ids.js";\nexport default definePlugin({ activate(ctx) { ctx.commands.register(id, () => {}); } });\n`,
      "lib/ids.js": `export const id = "hello";\n`,
    });
    expect(act(dir).code).toBe(0);
  });

  it("gives the plugin a clean environment (no tokens)", () => {
    const dir = plugin({
      "plugin.toml": manifest(cmd("hello")),
      "main.js": `export default { activate(ctx) { if (process.env.SECRET_TOKEN) throw new Error("leaked"); ctx.commands.register("hello", () => {}); } };\n`,
    });
    const r = run(["check", dir, "--activate"], { env: { SECRET_TOKEN: "x" } });
    expect(r.code, r.out).toBe(0);
  });

  it("refuses a zip and bad --timeout values with exit 2", () => {
    const dir = plugin({ "plugin.toml": manifest(cmd("hello")), "main.js": OK });
    expect(run(["check", dir, "--timeout", "500"]).code).toBe(2);
    expect(act(dir, "--timeout", "5").code).toBe(2);
    expect(act(dir, "--timeout", "abc").code).toBe(2);
    const zip = path.join(tmp("vdp-act-zip-"), "x.zip");
    write(path.dirname(zip), { "x.zip": "not a zip" });
    const r = act(zip);
    expect(r.code).toBe(2);
    expect(r.err).toContain("needs a plugin folder");
  });

  it("keeps its event list equal to the API", () => {
    const api = readFileSync(path.join(SDK, "api", "src", "events.ts"), "utf8");
    const fromApi = [...api.matchAll(/^\s*"([a-z]+\.[a-z]+)":/gm)].map((m) => m[1]);
    const child = readFileSync(
      path.join(SDK, "cli", "src", "activateChild.mjs"),
      "utf8",
    );
    const list = /EVENT_NAMES = \[([^\]]*)\]/.exec(child)[1];
    const fromChild = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(fromChild.sort()).toEqual(fromApi.sort());
    expect(fromApi.length).toBeGreaterThan(0);
  });
});
