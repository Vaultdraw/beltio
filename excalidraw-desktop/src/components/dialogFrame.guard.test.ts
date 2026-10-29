import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard: one modal frame. Every dialog renders through components/Dialog.tsx,
 * so Escape (top dialog only), the Tab trap, focus return, the scrim and the
 * footer are the same everywhere. A component that draws its own backdrop or
 * `role="dialog"` fails here; add it to ALLOWED only with a reason.
 */
const ROOT = resolve(__dirname, "../../..");

const ALLOWED: Record<string, string> = {
  "excalidraw-desktop/src/components/Dialog.tsx": "the frame itself",
  "excalidraw-desktop/src/components/QuickSwitcher.tsx":
    "command palette: a picker opened by key, own Escape (clear query first); uses the frame's classes",
  "excalidraw-desktop/src/components/settings/SettingsModal.tsx":
    "the settings window: full-size two-pane surface, own Escape (clear search first); uses the scrim class",
  "excalidraw-desktop/src/components/readonly/ReadOnlyBadge.tsx":
    "a non-modal popover (no aria-modal, no backdrop)",
  "plugins/official/_shared/DialogFrame.tsx":
    "the one frame copy the official plugins share (they use the public API only, so cannot import Dialog)",
};

const PATTERN =
  /role=["{]["']?dialog["'}]|aria-modal|className=["`{][^"`}]*\b(vault-modal-backdrop|vd-dialog-scrim)\b/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.tsx$/.test(name) && !/\.(test|spec)\.tsx$/.test(name)) {
      out.push(path);
    }
  }
  return out;
};

describe("dialog frame guard", () => {
  it("no component builds its own modal frame outside Dialog.tsx", () => {
    const files = [
      ...walk(join(ROOT, "excalidraw-desktop/src")),
      ...walk(join(ROOT, "plugins")),
    ];
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((rel) => !(rel in ALLOWED))
      .filter((rel) => PATTERN.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the legacy .vault-modal styles and their animation are gone", () => {
    const css = readFileSync(
      join(ROOT, "excalidraw-desktop/src/components/VaultShell.css"),
      "utf8",
    );
    expect(css).not.toMatch(/\.vault-modal/);
    expect(css).not.toMatch(/vault-modal-scale/);
  });

  it("every allowed exception still exists (no stale entries)", () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(statSync(join(ROOT, rel)).isFile()).toBe(true);
    }
  });
});

describe("plugin dialog frame", () => {
  it("shares the app's Escape stack and offers the same keyboard contract", () => {
    const app = readFileSync(join(__dirname, "escapeLayers.ts"), "utf8");
    const plugin = readFileSync(
      join(ROOT, "plugins/official/_shared/DialogFrame.tsx"),
      "utf8",
    );
    const key = /Symbol\.for\("([^"]+)"\)/;
    expect(app.match(key)?.[1]).toBeTruthy();
    expect(plugin.match(key)?.[1]).toBe(app.match(key)?.[1]);
  });

  it("every official plugin dialog goes through the shared frame", () => {
    for (const file of [
      "plugins/official/formula/src/FormulaDialog.tsx",
      "plugins/official/pdf-import/src/Dialog.tsx",
    ]) {
      expect(readFileSync(join(ROOT, file), "utf8")).toMatch(
        /from "\.\.\/\.\.\/_shared\/DialogFrame"/,
      );
    }
  });
});

describe("dialog footer", () => {
  it("small buttons never shrink the footer (one footer height)", () => {
    const css = readFileSync(join(__dirname, "dialogs.css"), "utf8");
    for (const rule of css.match(/[^}]*vault-btn--sm[^{]*\{/g) ?? []) {
      expect(rule).toMatch(/vd-dialog__body/);
    }
  });
});
