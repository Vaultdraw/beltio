/**
 * Family hunter canvas (2026-10-31), family of toimprove 220: "a command that changes the drawing
 * runs only with focus in the drawing, never from a text field". 220 fixed three Markdown
 * commands and swept two keys in a browser spec. This one asks the registry itself: which
 * built-in commands can fire with the focus in a text field outside the editor (search box,
 * Settings field, dialog input) while a vault and a drawing are open? Each one must be on the
 * list of app-level commands below; a new command with a modifier chord and no focus guard
 * fails here until someone decides it belongs there. Plugin manifests get the same table.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTION_COMMANDS } from "../commands/actionCommands";
import { BUILTIN_COMMANDS } from "../commands/commands";
import { whenHolds } from "../commands/context";
import { effectiveKeys } from "../commands/keymap";

import type { CommandContext } from "../commands/types";

// A text field outside the editor: textEditing on, no editor, canvas, list or view focus.
const FIELD: CommandContext = {
  vaultOpen: true,
  drawingOpen: true,
  writable: true,
  textEditing: true,
  canvasFocus: false,
  editorFocus: false,
  modalOpen: false,
  listFocus: false,
  galleryFocus: false,
  graphFocus: false,
} as CommandContext;

/** App-level commands: they act on the window, the vault or the view, not on drawing content. */
const APP_LEVEL = new Set([
  "file.save",
  "settings.open",
  "navigator.focusSearch",
  "navigator.focusTree",
  "navigator.refresh",
  "view.toggleNavigator",
  "view.focusMode",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomReset",
  "palette.files",
  "palette.commands",
  "vault.newDrawing",
  "vault.newFromTemplate",
  "links.toggleDock",
  "links.back",
  "links.forward",
  "history.checkpoint",
  "history.toggle",
]);
const isTabCommand = (id: string) => id.startsWith("tabs.");

const hasChord = (id: string, chords: string[]) =>
  chords.some((c) => /(Mod|Ctrl|Alt|Meta)\+/.test(c)) || !id;

describe("family: commands that fire from a text field outside the editor", () => {
  const fires = [...BUILTIN_COMMANDS, ...ACTION_COMMANDS]
    .filter((c, i, all) => all.findIndex((d) => d.id === c.id) === i)
    .filter((c) => hasChord(c.id, effectiveKeys(c, {} as never, "mac")))
    .filter((c) => whenHolds(c.when, FIELD));

  it("sanity: the table finds the app-level commands", () => {
    expect(fires.map((c) => c.id)).toContain("file.save");
  });

  it("every one of them is app-level (none edits the drawing)", () => {
    const unknown = fires
      .map((c) => c.id)
      .filter((id) => !APP_LEVEL.has(id) && !isTabCommand(id));
    expect(unknown).toEqual([]);
  });
});

describe("family: official plugin commands with a key and no focus guard", () => {
  const dir = join(__dirname, "../../../plugins/official");
  type Cmd = { plugin: string; id: string; keys: string; when: string };
  const found: Cmd[] = [];
  for (const plugin of readdirSync(dir)) {
    let toml = "";
    try {
      toml = readFileSync(join(dir, plugin, "plugin.toml"), "utf8");
    } catch {
      continue;
    }
    for (const block of toml.split("[[contributes.commands]]").slice(1)) {
      const body = block.split(/\n\[/)[0];
      const id = /^id\s*=\s*"([^"]+)"/m.exec(body)?.[1] ?? "";
      const keys = /^keys\s*=\s*(\[.*\])/m.exec(body)?.[1] ?? "";
      const when = /^when\s*=\s*(\[.*\])/m.exec(body)?.[1] ?? "";
      if (/(Mod|Ctrl|Alt)\+/.test(keys)) {
        found.push({ plugin, id, keys, when });
      }
    }
  }
  const GUARDS =
    /textEditing|editorFocus|canvasFocus|listFocus|galleryFocus|graphFocus/;
  // decided: opens a dialog or changes a list outside the drawing's content
  const DECIDED = new Set([
    "favourites.toggle",
    "formula.insert",
    "gallery.toggle",
    "graph.open",
    "graph.openLocal",
  ]);

  it("sanity: the manifests were read", () => {
    expect(found.length).toBeGreaterThan(3);
  });

  it("each is decided", () => {
    const undecided = found
      .filter((c) => !GUARDS.test(c.when))
      .map((c) => `${c.plugin}.${c.id}`)
      .filter((id) => !DECIDED.has(id));
    expect(undecided).toEqual([]);
  });
});
