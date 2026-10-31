/**
 * Family hunter canvas (2026-10-31): "every Markdown role colour reads at 4.5:1 on the canvas
 * actually shown" (roleColors.ts MIN_ROLE_CONTRAST; roleColors.test.ts checks "#ffffff" and
 * "#121212"). In page mode the canvas shown is the PAPER. The "Old school" paper is cream
 * (#f8efd4), but `canvasSync.applyRoleColors` resolves every identity paper against
 * STANDARD_CANVAS (white): a colour held at exactly 4.5:1 on white reads at about 3.9:1 on
 * cream. Table: every built-in theme and mode x every role x each paper that is not the theme's
 * page, through the real resolver the editor installs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAPER_THEME_COLORS } from "@excalidraw/excalidraw/data/pageSetup";

import { builtinRegistry } from "../theme/registry";
import { contrastRatio } from "../theme/color";

import {
  resetCanvasSync,
  setCanvasThemeSource,
  setPageDisplay,
} from "./canvasSync";

type Resolver = (
  role: string,
  isDark: boolean,
  stored: string,
  base?: string,
) => string | null;
const { resolvers } = vi.hoisted(() => ({
  resolvers: [] as Array<Resolver | null>,
}));

vi.mock("@excalidraw/excalidraw", () => ({
  setDisplayColorTransform: () => {},
  setDisplayTextRoleColor: (fn: Resolver | null) => {
    resolvers.push(fn);
  },
  invertColorForDarkMode: (c: string) => (c === "#ffffff" ? "#121212" : c),
}));

const ROLES = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "quote",
  "link",
  "code",
  "bold",
  "italic",
];
const MIN = 4.5;
const entries = builtinRegistry().themes.filter((e) => e.theme);

beforeEach(() => {
  resolvers.length = 0;
});
afterEach(() => resetCanvasSync());

for (const paper of ["normal", "oldSchool"] as const) {
  const background = PAPER_THEME_COLORS[paper].background;
  describe(`page mode, ${paper} paper (${background}): every role reads at ${MIN}:1`, () => {
    const run = () => {
      const low: string[] = [];
      for (const entry of entries) {
        for (const mode of ["light", "dark"] as const) {
          if (
            entry.theme![mode].mSurface.toLowerCase() ===
            background.toLowerCase()
          ) {
            continue; // the theme's own page: its colours as written (roleColors.ts)
          }
          resolvers.length = 0;
          setCanvasThemeSource({
            variant: entry.theme![mode],
            mode,
            key: `${entry.id ?? entry.theme!.id}-${mode}`,
          });
          setPageDisplay("identity");
          const resolve = resolvers[resolvers.length - 1];
          expect(resolve, "the editor installs a role resolver").toBeTruthy();
          for (const role of ROLES) {
            const color = resolve!(role, mode === "dark", "#1e1e1e");
            const ratio = contrastRatio(color!, background);
            if (ratio < MIN - 0.005) {
              low.push(
                `${entry.theme!.id} ${mode} ${role} ${color} ${ratio.toFixed(
                  2,
                )}`,
              );
            }
          }
          setPageDisplay(null);
        }
      }
      expect(low, `${low.length} role colours under ${MIN}:1`).toEqual([]);
    };
    (paper === "oldSchool" ? it.fails : it)(
      paper === "oldSchool"
        ? "every built-in theme and mode (toimprove 312)"
        : "every built-in theme and mode",
      run,
    );
  });
}
