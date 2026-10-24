import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  checkAppVersion,
  createSandbox,
  findApp,
  readAppVersion,
  removeSandbox,
} from "../src/sandbox.mjs";

import {
  cleanup,
  makePlugin,
  run,
  start,
  tmp,
  waitFor,
  write,
} from "./helpers.mjs";

afterAll(cleanup);

/**
 * A fake app binary: records what it was given, then exits, fails or waits for SIGTERM
 * (FAKE_APP_MODE). It also tries to "touch the real vault" the way a careless app would
 * (HOME and XDG fall-backs) only if the sandbox variables are missing.
 */
const fakeApp = (dir = tmp("vdp-fakeapp-")) => {
  const bin = path.join(dir, "fake-app");
  writeFileSync(
    bin,
    `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const e = process.env;
const rec = {
  vault: e.VAULTDRAW_VAULT,
  config: e.VAULTDRAW_CONFIG_DIR,
  state: e.VAULTDRAW_STATE_DIR,
  home: e.HOME,
  configToml: e.VAULTDRAW_CONFIG_DIR && fs.readFileSync(path.join(e.VAULTDRAW_CONFIG_DIR, "config.toml"), "utf8"),
  plugins: e.VAULTDRAW_CONFIG_DIR && fs.readdirSync(path.join(e.VAULTDRAW_CONFIG_DIR, "plugins")),
  vaultFiles: e.VAULTDRAW_VAULT && fs.readdirSync(e.VAULTDRAW_VAULT),
};
fs.writeFileSync(e.FAKE_APP_OUT, JSON.stringify(rec));
console.error("fake app: opening " + e.VAULTDRAW_VAULT);
const mode = e.FAKE_APP_MODE || "exit";
if (mode === "exit") process.exit(0);
if (mode === "fail") process.exit(3);
process.on("SIGTERM", () => { fs.writeFileSync(e.FAKE_APP_OUT + ".term", "1"); process.exit(0); });
setInterval(() => {}, 1000);
`,
  );
  chmodSync(bin, 0o755);
  return bin;
};

/** A stand-in for the developer's real folders, with files that must never change. */
const realHome = () => {
  const home = tmp("vdp-home-");
  const cfg = path.join(home, ".config", "vaultdraw");
  const st = path.join(home, ".local", "state", "vaultdraw");
  const realVault = path.join(home, "MyVault");
  write(cfg, { "config.toml": "# real\n[plugins]\nenabled = []\n" });
  write(st, { "recent-vault": realVault });
  write(realVault, { "Real.excalidraw": "{}" });
  const digest = () =>
    createHash("sha256")
      .update(
        [cfg, st, realVault]
          .flatMap((d) =>
            readdirSync(d, { recursive: true })
              .map(
                (f) =>
                  `${f}:${readFileSync(path.join(d, f), {
                    encoding: "utf8",
                    flag: "r",
                  })}`,
              )
              .concat(readdirSync(d, { recursive: true })),
          )
          .join("|"),
      )
      .digest("hex");
  return { home, cfg, st, realVault, digest };
};

const sandboxRun = (plugin, app, env) => {
  const out = path.join(tmp("vdp-rec-"), "rec.json");
  const r = run(["dev", plugin, "--sandbox", "--app", app], {
    env: { FAKE_APP_OUT: out, ...env },
  });
  return {
    ...r,
    rec: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null,
  };
};

describe("createSandbox and removeSandbox", () => {
  it("makes a short folder with config, state and one drawing", () => {
    const sb = createSandbox("demo-plugin");
    try {
      expect(sb.base.length).toBeLessThan(30);
      expect(
        readFileSync(path.join(sb.config, "config.toml"), "utf8"),
      ).toContain('enabled = ["demo-plugin"]');
      expect(readdirSync(sb.vault)).toEqual(["Sandbox drawing.excalidraw"]);
      expect(
        JSON.parse(
          readFileSync(
            path.join(sb.vault, "Sandbox drawing.excalidraw"),
            "utf8",
          ),
        ).type,
      ).toBe("excalidraw");
      expect(sb.env).toEqual({
        VAULTDRAW_CONFIG_DIR: sb.config,
        VAULTDRAW_STATE_DIR: sb.state,
        VAULTDRAW_VAULT: sb.vault,
      });
      for (const p of [sb.config, sb.state, sb.vault]) {
        expect(p.startsWith(sb.base + path.sep)).toBe(true);
      }
    } finally {
      expect(removeSandbox(sb.base)).toBe(true);
    }
    expect(existsSync(sb.base)).toBe(false);
  });

  it("removes only a folder it made", () => {
    const stranger = tmp("vds-");
    expect(removeSandbox(stranger)).toBe(false); // no marker, not under /tmp
    const real = realHome();
    expect(removeSandbox(real.home)).toBe(false);
    expect(removeSandbox(path.join(real.home, "missing"))).toBe(false);
    expect(existsSync(real.cfg)).toBe(true);
    const sb = createSandbox("demo-plugin");
    // A marked folder not named vds-* or nested deeper is refused too.
    expect(removeSandbox(sb.config)).toBe(false);
    expect(existsSync(sb.config)).toBe(true);
    removeSandbox(sb.base);
  });
});

describe("findApp, readAppVersion, checkAppVersion", () => {
  it("prefers --app, then VAULTDRAW_APP, and explains a missing app", () => {
    const a = fakeApp();
    const b = fakeApp();
    expect(findApp({ app: a, env: { VAULTDRAW_APP: b } })).toBe(a);
    expect(findApp({ env: { VAULTDRAW_APP: b } })).toBe(b);
    expect(() => findApp({ env: {}, platform: "linux" })).toThrow(/--app/);
    expect(() => findApp({ app: "/nope/app", env: {} })).toThrow(/not found/);
  });

  it("accepts a .app bundle path and refuses a folder", () => {
    const root = tmp("vdp-bundle2-");
    const bin = path.join(
      root,
      "V.app",
      "Contents",
      "MacOS",
      "excalidraw-vault",
    );
    write(path.dirname(bin), { "excalidraw-vault": "" });
    expect(findApp({ app: path.join(root, "V.app"), env: {} })).toBe(bin);
    expect(() => findApp({ app: root, env: {} })).toThrow(/folder/);
  });

  it("reads the version from the macOS bundle", () => {
    const root = tmp("vdp-bundle-");
    const bin = path.join(root, "V.app", "Contents", "MacOS", "x");
    write(path.dirname(bin), { x: "" });
    write(path.join(root, "V.app", "Contents"), {
      "Info.plist":
        "<dict><key>CFBundleShortVersionString</key>\n<string>1.2.3</string></dict>",
    });
    expect(readAppVersion(bin)).toBe("1.2.3");
    expect(readAppVersion(fakeApp())).toBe(null);
  });

  it("refuses an app without plugins or older than min_app", () => {
    expect(checkAppVersion("0.1.1", null).error).toMatch(/no plugin support/);
    expect(checkAppVersion("0.1.2", "0.2.0").error).toMatch(/needs app 0.2.0/);
    expect(checkAppVersion("0.3.0", "0.2.0")).toEqual({});
    expect(checkAppVersion(null, "0.2.0").warning).toMatch(/Could not read/);
  });
});

describe("dev --sandbox", { timeout: 30000 }, () => {
  it("starts the app on a sandbox, installs the plugin, and removes everything on exit", () => {
    const real = realHome();
    const before = real.digest();
    const plugin = makePlugin();
    const app = fakeApp();
    const r = sandboxRun(plugin, app, {
      HOME: real.home,
      XDG_CONFIG_HOME: "",
      XDG_STATE_HOME: "",
      FAKE_APP_MODE: "exit",
    });
    expect(r.code, r.out + r.err).toBe(0);
    const rec = r.rec;
    // The app saw only sandbox paths, all inside one short folder.
    const base = path.dirname(rec.vault);
    expect(path.dirname(rec.config)).toBe(base);
    expect(path.dirname(rec.state)).toBe(base);
    expect(base).toMatch(/\/vds-[0-9A-Za-z]+$/);
    expect(rec.configToml).toContain('enabled = ["demo-plugin"]');
    expect(rec.plugins).toEqual(["demo-plugin"]);
    expect(rec.vaultFiles).toEqual(["Sandbox drawing.excalidraw"]);
    // The app's message is shown, and the folder is gone.
    expect(r.out).toContain(`app | fake app: opening ${rec.vault}`);
    expect(r.out).toContain(`Vault:   ${rec.vault}`);
    expect(existsSync(base)).toBe(false);
    // The developer's real config, state and vault did not change.
    expect(real.digest()).toBe(before);
  });

  it("keeps the real vault out of reach: none of the sandbox paths is under the real home", () => {
    const real = realHome();
    const r = sandboxRun(makePlugin(), fakeApp(), {
      HOME: real.home,
      FAKE_APP_MODE: "exit",
    });
    expect(r.code).toBe(0);
    for (const p of [r.rec.vault, r.rec.config, r.rec.state]) {
      expect(p.startsWith(real.home)).toBe(false);
    }
    expect(r.rec.vault).not.toBe(real.realVault);
  });

  it("stops the app and removes the folder when dev is stopped", async () => {
    const plugin = makePlugin();
    const app = fakeApp();
    const out = path.join(tmp("vdp-rec-"), "rec.json");
    const s = start(["dev", plugin, "--sandbox", "--app", app], {
      env: { FAKE_APP_OUT: out, FAKE_APP_MODE: "wait" },
    });
    await waitFor(
      () => existsSync(out) && s.output().includes("Watching"),
      15000,
    );
    const rec = JSON.parse(readFileSync(out, "utf8"));
    const base = path.dirname(rec.vault);
    expect(existsSync(base)).toBe(true);
    // A saved change reaches the sandbox copy.
    writeFileSync(
      path.join(plugin, "main.js"),
      "export default { activate() {} };\n// edit\n",
    );
    await waitFor(
      () =>
        readFileSync(
          path.join(rec.config, "plugins", "demo-plugin", "main.js"),
          "utf8",
        ).includes("// edit"),
      8000,
    );
    const end = await s.stop();
    expect(end.code).toBe(0);
    await waitFor(() => existsSync(`${out}.term`), 5000); // the app got SIGTERM
    expect(existsSync(base)).toBe(false);
  });

  it("returns 1 when the app fails, and still cleans up", () => {
    const r = sandboxRun(makePlugin(), fakeApp(), { FAKE_APP_MODE: "fail" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("The app exited with code 3");
    expect(existsSync(path.dirname(r.rec.vault))).toBe(false);
  });

  it("explains a missing app and cleans up nothing it did not make", () => {
    const r = run(["dev", makePlugin(), "--sandbox", "--app", "/nope/app"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not found");
    const noPlugin = run([
      "dev",
      tmp("vdp-empty-"),
      "--sandbox",
      "--app",
      fakeApp(),
    ]);
    expect(noPlugin.code).toBe(1);
    expect(noPlugin.err).toContain("plugin.toml");
  });

  it("refuses an app that is too old", () => {
    const root = tmp("vdp-oldapp-");
    const bin = path.join(root, "V.app", "Contents", "MacOS", "fake-app");
    mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, readFileSync(fakeApp()));
    chmodSync(bin, 0o755);
    write(path.join(root, "V.app", "Contents"), {
      "Info.plist":
        "<key>CFBundleShortVersionString</key><string>0.1.1</string>",
    });
    const r = run(["dev", makePlugin(), "--sandbox", "--app", bin]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no plugin support");
  });

  it("rejects options that do not fit", () => {
    const p = makePlugin();
    expect(run(["dev", p, "--sandbox", "--config-dir", tmp()]).code).toBe(2);
    expect(
      run(["dev", p, "--sandbox", "--once", "--app", fakeApp()]).code,
    ).toBe(2);
    expect(run(["dev", p, "--app", fakeApp(), "--once"]).code).toBe(2);
  });
});
