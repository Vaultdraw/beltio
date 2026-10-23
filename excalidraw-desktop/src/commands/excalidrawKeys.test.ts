/**
 * Drift test: EXCALIDRAW_KEYS must match what packages/excalidraw defines.
 * If this fails after an upstream change, update excalidrawKeys.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXCALIDRAW_KEYS, excalidrawActionsFor } from "./excalidrawKeys";
import { normalizeChord, parseChord } from "./keys";
import { TOOL_COMMANDS } from "./toolCommands";

const packages = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/excalidraw",
);
const read = (rel: string) => readFileSync(path.join(packages, rel), "utf8");

/** Upstream chord text ("CtrlOrCmd+Shift+[", "?") -> our canonical chord. */
const toChord = (text: string): string => {
  if (text === "?") {
    return "Shift+Slash";
  }
  const chord = parseChord(text);
  if (!chord) {
    throw new Error(`Cannot convert upstream shortcut "${text}"`);
  }
  return chord;
};

const sorted = (set: Set<string>) => [...set].sort();

const hint =
  "packages/excalidraw changed: update src/commands/excalidrawKeys.ts";

/** "action|chord" pairs from `shortcutMap` in actions/shortcuts.ts. */
function shortcutMapPairs(): Set<string> {
  const source = read("actions/shortcuts.ts");
  const start = source.indexOf("const shortcutMap");
  const block = source.slice(start, source.indexOf("\n};", start));
  const pairs = new Set<string>();
  for (const entry of block.matchAll(/^ {2}(\w+): \[([\s\S]*?)\],?$/gm)) {
    // plain string literals only; `Alt+${t("helpDialog.drag")}` is not a key
    for (const key of entry[2].matchAll(/getShortcutKey\("([^"]+)"\)/g)) {
      pairs.add(`${entry[1]}|${toChord(key[1])}`);
    }
  }
  return pairs;
}

/** "tool.<name>|<chord>" pairs from `TOOLS` in components/Tools.tsx. */
function toolPairs(): Set<string> {
  const source = read("components/Tools.tsx");
  const start = source.indexOf("export const TOOLS = defineTools({");
  const block = source.slice(start, source.indexOf("\n});", start));
  const pairs = new Set<string>();
  for (const tool of block.matchAll(/^ {2}(\w+): \{([\s\S]*?)^ {2}\},/gm)) {
    const [, name, body] = tool;
    const shift = /shiftKey: true/.test(body);
    const letters = body.match(/letterKey: (\[[^\]]*\]|KEYS\.\w+)/)?.[1] ?? "";
    for (const letter of letters.matchAll(/KEYS\.(\w+)/g)) {
      pairs.add(`tool.${name}|${shift ? "Shift+" : ""}${letter[1]}`);
    }
    const digit = body.match(/numericKey: KEYS\["(\d)"\]/)?.[1];
    if (digit) {
      pairs.add(`tool.${name}|${digit}`);
    }
  }
  return pairs;
}

const tablePairs = (source: string) =>
  new Set(
    EXCALIDRAW_KEYS.filter((k) => k.source === source).map(
      (k) => `${k.action}|${k.chord}`,
    ),
  );

describe("EXCALIDRAW_KEYS drift", () => {
  it("matches shortcutMap in actions/shortcuts.ts", () => {
    const upstream = shortcutMapPairs();
    expect(upstream.size).toBeGreaterThan(30);
    expect(sorted(tablePairs("shortcutMap")), hint).toEqual(sorted(upstream));
  });

  it("matches the tool keys in components/Tools.tsx", () => {
    const upstream = toolPairs();
    expect(upstream.size).toBeGreaterThan(20);
    expect(sorted(tablePairs("tool")), hint).toEqual(sorted(upstream));
  });
});

describe("tool commands vs Excalidraw", () => {
  it("tool.* defaults equal the keys in TOOLS and the Q tool lock", () => {
    const commands = new Set(
      TOOL_COMMANDS.filter((c) => c.id !== "tool.lock").flatMap((c) =>
        c.keys.default.map((key) => `${c.id}|${toChord(key)}`),
      ),
    );
    expect(sorted(commands), hint).toEqual(sorted(toolPairs()));
    const lock = TOOL_COMMANDS.find((c) => c.id === "tool.lock");
    expect(lock?.keys.default.map(toChord)).toEqual(
      [...shortcutMapPairs()]
        .filter((pair) => pair.startsWith("toolLock|"))
        .map((pair) => pair.split("|")[1]),
    );
  });
});

describe("EXCALIDRAW_KEYS table", () => {
  it("only contains canonical, platform-normalised chords", () => {
    for (const { chord } of EXCALIDRAW_KEYS) {
      expect(parseChord(chord)).toBe(chord);
      expect(normalizeChord(chord, "mac")).toBe(chord);
    }
  });

  it("looks up actions by chord and platform", () => {
    expect(excalidrawActionsFor("Mod+D", "mac").map((k) => k.action)).toEqual([
      "duplicateSelection",
    ]);
    expect(excalidrawActionsFor("Meta+D", "mac")).toHaveLength(1);
    expect(excalidrawActionsFor("Mod+D", "win")).toHaveLength(1);
    expect(excalidrawActionsFor("Mod+S", "mac")).toHaveLength(1); // one label
    expect(excalidrawActionsFor("Mod+Alt+BracketLeft", "mac")).toHaveLength(1);
    expect(excalidrawActionsFor("Mod+Alt+BracketLeft", "win")).toHaveLength(0);
    expect(excalidrawActionsFor("Mod+Shift+BracketLeft", "win")).toHaveLength(
      1,
    );
    expect(excalidrawActionsFor("R", "mac")[0].action).toBe("tool.rectangle");
    expect(excalidrawActionsFor("Mod+Shift+J", "mac")).toEqual([]);
  });
});
