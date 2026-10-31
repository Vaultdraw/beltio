/**
 * Family hunter canvas (2026-10-31), family of toimprove 238, 256, 257: "every writer of a text
 * colour records the pick". hunterLRoleColor.test.ts covers the colour panel, Paste styles and
 * the heading round trip. This table lists the OTHER writers of a role text's `strokeColor`:
 * what a user (or a plugin or the `vaultdraw` command acting for them) sets must show on screen,
 * not be hidden by the theme heading colour. The pick that matters is stock black (#000000 or #1e1e1e): any other colour already wins over the role.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getTextDisplayColor,
  setDisplayTextRoleColor,
} from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { applyOps } from "../sceneOps/apply";
import { stubApi } from "../sceneOps/testUtils";

const THEME_H1 = "#c92a2a";
const resolver = (
  role: string,
  _dark: boolean,
  stored: string,
  base?: string,
) => {
  const s = stored.toLowerCase();
  return role === "h1" && (s === "#1e1e1e" || s === "#000000" || s === base)
    ? THEME_H1
    : null;
};

afterEach(() => setDisplayTextRoleColor(null));

const heading = () =>
  ({
    ...convertToExcalidrawElements([
      { type: "text", text: "Plan", x: 0, y: 0, fontSize: 36 },
    ])[0],
    customData: { role: "h1" },
  } as never);

type Writer = {
  name: string;
  /** toimprove number when the member is broken */
  broken?: number;
  write: (color: string) => { strokeColor: string; customData?: any };
};

const writers: Writer[] = [
  {
    name: "plugin or CLI scene update (applyOps update strokeColor)",
    write: (color) => {
      const h = heading() as any;
      const { api, updateScene } = stubApi([h]);
      applyOps(api, [
        { op: "update", id: h.id, props: { strokeColor: color } },
      ]);
      return updateScene.mock.calls[0][0].elements[0];
    },
  },
];

describe("every writer of a role text's colour keeps the user's pick", () => {
  for (const w of writers) {
    const run = () => {
      setDisplayTextRoleColor(resolver);
      const out = w.write("#000000");
      expect(getTextDisplayColor(out as never, false)).toBe("#000000");
    };
    (w.broken !== undefined ? it.fails : it)(w.name, run);
  }
});
