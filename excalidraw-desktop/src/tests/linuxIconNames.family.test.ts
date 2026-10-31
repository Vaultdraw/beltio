/**
 * Family hunter shell, linux (2026-10-31): "every desktop entry the app writes or ships names an
 * icon that is installed". The packages install `excalidraw-vault.png` into hicolor
 * (`tauri.linux.conf.json` deb and rpm `files`); the `.desktop` the palette command "Links:
 * Register Vaultdraw for links and files" writes for AppImage and copied installs says
 * `Icon=vaultdraw`, and the command writes only the desktop file and the MIME file (no icon), so
 * the launcher entry has no icon. The package check script verifies the packaged entries only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TAURI = join(__dirname, "..", "..", "src-tauri");
const iconOf = (text: string) => /^Icon=(.+)$/m.exec(text)?.[1];

const conf = JSON.parse(
  readFileSync(join(TAURI, "tauri.linux.conf.json"), "utf8"),
);
const installedIcons = (target: "deb" | "rpm") =>
  Object.keys(conf.bundle.linux[target].files)
    .filter((p) => p.startsWith("/usr/share/icons/hicolor/"))
    .map((p) => /\/([^/]+)\.png$/.exec(p)![1]);

describe("family (linux): a desktop entry's icon is installed", () => {
  const packaged = readFileSync(join(TAURI, "linux", "bundle.desktop"), "utf8");
  const registered = readFileSync(
    join(TAURI, "linux", "vaultdraw.desktop"),
    "utf8",
  );
  const handlers = readFileSync(
    join(TAURI, "src", "control", "linux_handlers.rs"),
    "utf8",
  );

  it("sanity: both deb and rpm install the same icon names", () => {
    expect(new Set(installedIcons("deb"))).toEqual(
      new Set(installedIcons("rpm")),
    );
    expect(installedIcons("deb")).toContain("excalidraw-vault");
    expect(iconOf(packaged)).toBe("{{icon}}");
  });

  it(
    "the entry the registration command writes names an installed icon (toimprove 310)",
    () => {
      const wrote = /write.*icon|\.png/i.test(handlers);
      expect(wrote || installedIcons("deb").includes(iconOf(registered)!)).toBe(
        true,
      );
    },
  );
});
