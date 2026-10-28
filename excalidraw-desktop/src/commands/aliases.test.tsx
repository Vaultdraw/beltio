import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPreferences, updatePreferences } from "../vault/preferences";

import {
  aliasesOf,
  aliasTarget,
  COMMAND_ALIASES,
  resetAliasNotices,
  resolveCommandId,
} from "./aliases";
import { getCommand } from "./commands";
import { effectiveKeys } from "./keymap";
import { registerCommands } from "./registry";
import { setHotkeyOverride, useCommandDispatcher } from "./useCommands";

import type { CommandDefinition } from "./types";

const app = { vaultOpen: true, drawingOpen: true, writable: true };
const def = (id: string, keys: string[] = []) =>
  ({
    id,
    title: id,
    category: "Test",
    keys: { default: keys },
  } as CommandDefinition);

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  window.localStorage.clear();
  resetAliasNotices();
  vi.restoreAllMocks();
});

describe("command aliases", () => {
  it("resolves old ids, leaves others alone, and lists the old ids of a command", () => {
    expect(aliasTarget("thumbnails.galleryToggle")).toBe("gallery.toggle");
    expect(aliasTarget("thumbnails.galleryOpen")).toBe("gallery.show-folder");
    expect(aliasTarget("file.importPdf")).toBe("pdf-import.import");
    expect(aliasTarget("file.save")).toBe("file.save");
    expect(aliasTarget("toString")).toBe("toString");
    expect(aliasesOf("gallery.toggle")).toEqual(["thumbnails.galleryToggle"]);
    // no cycles, no row pointing at itself
    for (const old of Object.keys(COMMAND_ALIASES)) {
      expect(aliasTarget(old)).not.toBe(old);
      expect(aliasTarget(aliasTarget(old))).toBe(aliasTarget(old));
    }
  });

  it("logs one notice per old id, no dialog", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    resolveCommandId("file.importPdf");
    resolveCommandId("file.importPdf");
    resolveCommandId("file.save");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain("pdf-import.import");
  });

  it("getCommand finds a plugin command that registers later, by its old id", () => {
    expect(getCommand("thumbnails.galleryToggle")).toBeUndefined();
    disposers.push(registerCommands([def("gallery.toggle")]));
    expect(getCommand("thumbnails.galleryToggle")?.id).toBe("gallery.toggle");
  });

  it("a binding on the old id applies to the new command; an entry on the new id wins", () => {
    const command = def("gallery.toggle", ["Mod+G"]);
    expect(
      effectiveKeys(
        command,
        { "thumbnails.galleryToggle": ["Mod+Alt+G"] },
        "mac",
      ),
    ).toEqual(["Mod+Alt+G"]);
    expect(
      effectiveKeys(
        command,
        {
          "thumbnails.galleryToggle": ["Mod+Alt+G"],
          "gallery.toggle": ["Mod+Shift+G"],
        },
        "mac",
      ),
    ).toEqual(["Mod+Shift+G"]);
  });

  it("pressing a key bound to the old id runs the new command", () => {
    const toggle = vi.fn();
    disposers.push(registerCommands([def("gallery.toggle", ["Mod+G"])]));
    updatePreferences(
      { hotkeys: { "thumbnails.galleryToggle": ["Alt+Shift+Q"] } },
      window,
    );
    renderHook(() =>
      useCommandDispatcher(document, window, {
        handlers: { "gallery.toggle": toggle },
        app,
      }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyQ",
        key: "Q",
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("run by old id works; with the new command absent it is unavailable, not an error", () => {
    const toggle = vi.fn();
    const { result } = renderHook(() =>
      useCommandDispatcher(document, window, {
        handlers: { "gallery.toggle": toggle },
        app,
      }),
    );
    // plugin off: no registered definition for the new id
    expect(result.current.isAvailable("thumbnails.galleryToggle")).toBe(false);
    expect(() => result.current.run("thumbnails.galleryToggle")).not.toThrow();
    expect(result.current.run("thumbnails.galleryToggle")).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    // plugin on (registers later): the same old id now runs it
    disposers.push(registerCommands([def("gallery.toggle")]));
    expect(result.current.run("thumbnails.galleryToggle")).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("setting a new binding drops the old id's entry so it cannot come back", () => {
    updatePreferences(
      { hotkeys: { "thumbnails.galleryToggle": ["Mod+K"] } },
      window,
    );
    act(() => setHotkeyOverride("gallery.toggle", ["Mod+J"], window));
    expect(getPreferences(window).hotkeys).toEqual({
      "gallery.toggle": ["Mod+J"],
    });
  });
});
