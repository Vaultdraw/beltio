import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { resolveDirs, EnvError } from "../src/dirs.mjs";
import {
  findInstalledNonDev,
  printEnvLines,
  syncOnce,
  withDevTrue,
} from "../src/dev.mjs";

import {
  cleanup,
  makePlugin,
  MANIFEST,
  run,
  start,
  tmp,
  waitFor,
  write,
} from "./helpers.mjs";

afterAll(cleanup);

/** A fake app config folder. */
const fakeApp = () => {
  const config = tmp("vdp-app-");
  mkdirSync(path.join(config, "plugins"));
  writeFileSync(path.join(config, "config.toml"), "# the user's settings\n");
  return config;
};
const installed = (config, ...rel) =>
  path.join(realpathSync(config), "plugins", "demo-plugin", ...rel);
const dev = (dir, config, ...extra) =>
  run(["dev", dir, "--config-dir", config, "--once", ...extra]);

describe("withDevTrue", () => {
  it("adds dev = true after the last top-level key and before the first table", () => {
    expect(
      withDevTrue(
        'id = "a"\nmain = "m.js"\n\n[[contributes.commands]]\nid = "c"\n',
      ),
    ).toBe(
      'id = "a"\nmain = "m.js"\ndev = true\n\n[[contributes.commands]]\nid = "c"\n',
    );
    expect(withDevTrue('id = "a"\n')).toBe('id = "a"\ndev = true\n');
  });

  it("replaces an existing dev line and is stable", () => {
    expect(
      withDevTrue('id = "a"\ndev = false\nmain = "m"\n[x-t]\ndev = false\n'),
    ).toBe('id = "a"\ndev = true\nmain = "m"\n[x-t]\ndev = false\n');
    const once = withDevTrue(MANIFEST);
    expect(withDevTrue(once)).toBe(once);
  });
});

describe("config directory resolution", () => {
  it("follows the app's ladder", () => {
    expect(
      resolveDirs(
        { VAULTDRAW_CONFIG_DIR: "/a/cfg", VAULTDRAW_STATE_DIR: "/a/st" },
        false,
      ),
    ).toMatchObject({
      config: "/a/cfg",
      state: "/a/st",
      configOverridden: true,
    });
    expect(
      resolveDirs(
        { XDG_CONFIG_HOME: "/x/c", XDG_STATE_HOME: "/x/s", HOME: "/h" },
        false,
      ),
    ).toMatchObject({
      config: "/x/c/vaultdraw",
      state: "/x/s/vaultdraw",
      configOverridden: false,
    });
    expect(resolveDirs({ HOME: "/h" }, false)).toMatchObject({
      config: "/h/.config/vaultdraw",
      state: "/h/.local/state/vaultdraw",
    });
  });

  it("treats empty variables as unset and ignores relative XDG values", () => {
    expect(
      resolveDirs(
        { VAULTDRAW_CONFIG_DIR: "", XDG_CONFIG_HOME: "rel", HOME: "/h" },
        false,
      ).config,
    ).toBe("/h/.config/vaultdraw");
  });

  it("refuses a relative override and a missing home", () => {
    expect(() => resolveDirs({ VAULTDRAW_CONFIG_DIR: "rel" }, false)).toThrow(
      /absolute/,
    );
    expect(() => resolveDirs({}, false)).toThrow(EnvError);
    expect(() => resolveDirs({}, false)).toThrow(/HOME/);
  });

  it("uses APPDATA on Windows", () => {
    expect(
      resolveDirs(
        { APPDATA: "C:\\Users\\a\\AppData\\Roaming", LOCALAPPDATA: "C:\\L" },
        true,
      ).config,
    ).toBe("C:\\Users\\a\\AppData\\Roaming\\Vaultdraw");
    expect(() => resolveDirs({}, true)).toThrow(/APPDATA/);
  });

  it("is used by dev when --config-dir is missing (injected env, never the real one)", () => {
    const config = fakeApp();
    const plugin = makePlugin();
    const r = run(["dev", plugin, "--once"], {
      env: { VAULTDRAW_CONFIG_DIR: config },
    });
    expect(r.code).toBe(0);
    expect(existsSync(installed(config, "plugin.toml"))).toBe(true);
    const home = tmp("vdp-home-");
    const viaHome = run(["dev", plugin, "--once"], {
      env: { VAULTDRAW_CONFIG_DIR: "", XDG_CONFIG_HOME: "", HOME: home },
    });
    expect(viaHome.code).toBe(2);
    expect(viaHome.err).toContain(path.join(home, ".config", "vaultdraw"));
    expect(viaHome.err).toContain("does not exist");
    expect(existsSync(path.join(home, ".config"))).toBe(false);
  });
});

describe("dev --once", () => {
  it("copies the plugin with dev = true and prints the one-time steps", () => {
    const config = fakeApp();
    const plugin = makePlugin({
      "assets/icon.txt": "i",
      "lib/util.js": "export const a = 1;\n",
    });
    const r = dev(plugin, config);
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "Cmd+Shift+P (Ctrl+Shift+P on Linux), Plugins: Reload plugin list; then Settings, Plugins, enable the plugin",
    );
    expect(readFileSync(installed(config, "plugin.toml"), "utf8")).toBe(
      `${MANIFEST}dev = true\n`,
    );
    expect(readFileSync(installed(config, "main.js"), "utf8")).toBe(
      readFileSync(path.join(plugin, "main.js"), "utf8"),
    );
    expect(readFileSync(installed(config, "assets", "icon.txt"), "utf8")).toBe(
      "i",
    );
    expect(readFileSync(installed(config, "lib", "util.js"), "utf8")).toContain(
      "export const a",
    );
    expect(existsSync(installed(config, "README.md"))).toBe(true);
    // the source manifest is untouched
    expect(readFileSync(path.join(plugin, "plugin.toml"), "utf8")).toBe(
      MANIFEST,
    );
  });

  it("never edits the user's config.toml", () => {
    const config = fakeApp();
    const before = statSync(path.join(config, "config.toml")).mtimeMs;
    dev(makePlugin(), config);
    expect(readFileSync(path.join(config, "config.toml"), "utf8")).toBe(
      "# the user's settings\n",
    );
    expect(statSync(path.join(config, "config.toml")).mtimeMs).toBe(before);
    expect(readdirSync(config).sort()).toEqual(["config.toml", "plugins"]);
  });

  it("ignores node_modules, .git, dot-files and test files, but copies README.md", () => {
    const config = fakeApp();
    const plugin = makePlugin({
      "node_modules/x/index.js": "x",
      ".git/HEAD": "ref",
      ".env": "SECRET=1",
      ".hidden/a.js": "a",
      "main.test.js": "t",
      "sub/util.test.ts": "t",
      "sub/util.js": "u",
    });
    dev(plugin, config);
    expect(readdirSync(installed(config)).sort()).toEqual([
      "README.md",
      "main.js",
      "plugin.toml",
      "sub",
    ]);
    expect(readdirSync(installed(config, "sub"))).toEqual(["util.js"]);
  });

  it("does not copy symbolic links", () => {
    const config = fakeApp();
    const plugin = makePlugin();
    symlinkSync("/etc/hosts", path.join(plugin, "link.txt"));
    dev(plugin, config);
    expect(existsSync(installed(config, "link.txt"))).toBe(false);
  });

  it("writes only what changed", () => {
    const config = fakeApp();
    const plugin = makePlugin({ "a.txt": "A" });
    dev(plugin, config);
    const past = new Date(Date.now() - 60_000);
    for (const f of ["plugin.toml", "main.js", "a.txt", "README.md"]) {
      utimesSync(installed(config, f), past, past);
    }
    dev(plugin, config);
    for (const f of ["plugin.toml", "main.js", "a.txt", "README.md"]) {
      expect(statSync(installed(config, f)).mtimeMs).toBe(past.getTime());
    }
    writeFileSync(path.join(plugin, "main.js"), "export default {};\n");
    dev(plugin, config);
    expect(statSync(installed(config, "main.js")).mtimeMs).toBeGreaterThan(
      past.getTime(),
    );
    expect(statSync(installed(config, "a.txt")).mtimeMs).toBe(past.getTime());
    expect(statSync(installed(config, "plugin.toml")).mtimeMs).toBe(
      past.getTime(),
    );
  });

  it("writes main last, and plugin.toml after the other files", () => {
    const config = tmp("vdp-app-");
    const plugin = makePlugin({ "a.js": "1", "z.js": "2" });
    const dest = path.join(config, "dest");
    // `written` lists the files in the order they were written.
    const seen = syncOnce(plugin, dest).written;
    expect(seen.at(-1)).toBe("main.js");
    expect(seen.indexOf("plugin.toml")).toBeGreaterThan(seen.indexOf("z.js"));
    expect(seen.indexOf("plugin.toml")).toBeLessThan(seen.indexOf("main.js"));
  });

  it("removes files deleted from the source, only inside the plugin's own folder", () => {
    const config = fakeApp();
    write(path.join(config, "plugins", "other-plugin"), {
      "plugin.toml": MANIFEST.replace("demo-plugin", "other-plugin"),
      "main.js": "",
    });
    const plugin = makePlugin({ "gone.txt": "x", "d/e/deep.txt": "y" });
    dev(plugin, config);
    expect(existsSync(installed(config, "gone.txt"))).toBe(true);
    expect(existsSync(installed(config, "d", "e", "deep.txt"))).toBe(true);
    rmSync(path.join(plugin, "gone.txt"));
    rmSync(path.join(plugin, "d"), { recursive: true });
    const r = dev(plugin, config);
    expect(r.code).toBe(0);
    expect(existsSync(installed(config, "gone.txt"))).toBe(false);
    expect(existsSync(installed(config, "d"))).toBe(false);
    expect(
      existsSync(path.join(config, "plugins", "other-plugin", "main.js")),
    ).toBe(true);
    expect(existsSync(path.join(config, "config.toml"))).toBe(true);
  });

  it("refuses an id that is installed without dev = true", () => {
    const config = fakeApp();
    write(path.join(config, "plugins", "demo-plugin"), {
      "plugin.toml": MANIFEST,
      "main.js": "// the user's copy\n",
    });
    const r = dev(makePlugin(), config);
    expect(r.code).toBe(1);
    expect(r.err).toContain("already installed");
    expect(r.err).toContain("Uninstall it first in Settings, Plugins");
    expect(readFileSync(installed(config, "main.js"), "utf8")).toBe(
      "// the user's copy\n",
    );
  });

  it("refuses when the same id sits in a differently named non-dev folder", () => {
    const config = fakeApp();
    write(path.join(config, "plugins", "renamed-folder"), {
      "plugin.toml": MANIFEST,
      "main.js": "",
    });
    const r = dev(makePlugin(), config);
    expect(r.code).toBe(1);
    expect(existsSync(installed(config))).toBe(false);
  });

  it("refuses to write over a foreign folder that has the id as its name but no manifest", () => {
    const config = fakeApp();
    write(path.join(config, "plugins", "demo-plugin"), {
      "notes.txt": "keep me",
    });
    expect(dev(makePlugin(), config).code).toBe(1);
    expect(readFileSync(installed(config, "notes.txt"), "utf8")).toBe(
      "keep me",
    );
  });

  it("updates an earlier dev copy", () => {
    const config = fakeApp();
    const plugin = makePlugin();
    expect(dev(plugin, config).code).toBe(0);
    writeFileSync(path.join(plugin, "main.js"), "export default { v: 2 };\n");
    expect(dev(plugin, config).code).toBe(0);
    expect(readFileSync(installed(config, "main.js"), "utf8")).toContain(
      "v: 2",
    );
  });

  it("finds installed copies with findInstalledNonDev", () => {
    const config = fakeApp();
    const plugins = path.join(config, "plugins");
    write(plugins, {
      "a/plugin.toml": `${MANIFEST}dev = true\n`,
      "b/plugin.toml": "this is not toml = = =",
      "c/plugin.toml": MANIFEST.replace("demo-plugin", "someone-else"),
    });
    expect(findInstalledNonDev(plugins, "demo-plugin")).toBeNull();
    write(plugins, { "d/plugin.toml": MANIFEST });
    expect(findInstalledNonDev(plugins, "demo-plugin")).toBe(
      path.join(plugins, "d"),
    );
  });

  it("exits 1 when the manifest or main is missing or the id is bad", () => {
    const config = fakeApp();
    expect(dev(tmp(), config).code).toBe(1);
    expect(
      dev(makePlugin({ "plugin.toml": 'id = "Bad_Id"\n' }), config).code,
    ).toBe(1);
    expect(dev(makePlugin({ "plugin.toml": 'id = "x\n' }), config).code).toBe(
      1,
    );
    const noMain = tmp();
    write(noMain, { "plugin.toml": MANIFEST });
    const r = dev(noMain, config);
    expect(r.code).toBe(1);
    expect(r.err).toContain("main.js");
    expect(readdirSync(path.join(config, "plugins"))).toEqual([]);
  });

  it("exits 2 for a missing folder or argument", () => {
    const config = fakeApp();
    expect(dev(path.join(config, "nope"), config).code).toBe(2);
    expect(run(["dev", "--config-dir", config, "--once"]).code).toBe(2);
  });

  it("refuses a source folder inside the plugins folder", () => {
    const config = fakeApp();
    const r = dev(path.join(config, "plugins"), config);
    expect(r.code).toBe(1);
  });

  it("creates an explicitly named config folder but not a default one", () => {
    const parent = tmp();
    const named = path.join(parent, "fresh-config");
    expect(dev(makePlugin(), named).code).toBe(0);
    expect(lstatSync(path.join(named, "plugins")).isDirectory()).toBe(true);
  });
});

describe("dev --print-env", () => {
  it("prints the app's real variable names, one per line, and creates nothing", () => {
    const r = run(["dev", "--print-env"]);
    expect(r.code).toBe(0);
    const lines = r.out.trim().split("\n");
    expect(lines.map((l) => l.split("=")[0])).toEqual([
      "VAULTDRAW_CONFIG_DIR",
      "VAULTDRAW_STATE_DIR",
    ]);
    for (const l of lines) {
      const value = l.slice(l.indexOf("=") + 1);
      expect(path.isAbsolute(value)).toBe(true);
      expect(existsSync(value)).toBe(false);
    }
    const again = run(["dev", "--print-env"]).out.trim().split("\n")[0];
    expect(again).not.toBe(lines[0]);
  });

  it("keeps an explicit --config-dir and quotes unsafe paths", () => {
    expect(printEnvLines({ configDir: "/a/my cfg" })[0]).toBe(
      "VAULTDRAW_CONFIG_DIR='/a/my cfg'",
    );
    expect(printEnvLines({ configDir: "/a/cfg" })[0]).toBe(
      "VAULTDRAW_CONFIG_DIR=/a/cfg",
    );
  });
});

describe("dev watch mode", () => {
  it("copies again when the source changes, and exits 0 on Ctrl+C", async () => {
    const config = fakeApp();
    const plugin = makePlugin();
    const p = start(["dev", plugin, "--config-dir", config]);
    try {
      await waitFor(() => p.output().includes("Watching"), 15000);
      expect(readFileSync(installed(config, "main.js"), "utf8")).toContain(
        "definePlugin",
      );
      writeFileSync(
        path.join(plugin, "main.js"),
        "export default { edited: true };\n",
      );
      await waitFor(
        () =>
          existsSync(installed(config, "main.js")) &&
          readFileSync(installed(config, "main.js"), "utf8").includes("edited"),
        3000,
      );
      writeFileSync(path.join(plugin, "new.txt"), "n");
      await waitFor(() => existsSync(installed(config, "new.txt")), 3000);
      await waitFor(() => /\d\d:\d\d:\d\d copied/.test(p.output()), 3000);
      // writes into ignored places do not sync
      mkdirSync(path.join(plugin, "node_modules"));
      writeFileSync(path.join(plugin, "node_modules", "x.js"), "x");
      await new Promise((r) => setTimeout(r, 400));
      expect(existsSync(installed(config, "node_modules"))).toBe(false);
    } finally {
      const done = await p.stop();
      expect(done.code).toBe(0);
    }
  }, 30000);
});
