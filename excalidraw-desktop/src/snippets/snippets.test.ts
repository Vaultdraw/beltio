import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { getRegisteredCommand } from "../commands/registry";
import { allCommands, getCommand, isCommandId } from "../commands/commands";
import { FakeSnippetSource } from "../tests/fakeSnippetSource";
import { getPreferences, updatePreferences } from "../vault/preferences";
import {
  configToPreferences,
  PREFERENCES_CHANGED_EVENT,
} from "../vault/settingsSync";

import { applyThemeTokens } from "../theme";
import { touchesConfigSubdir } from "../vault/configPaths";

import { waitAtMost } from "../platform/waitAtMost";

import { touchesSnippets, startSnippets } from "./boot";

import { appliedSnippetCount, applySnippetCss } from "./sheets";
import {
  boundSnippetToggleCommands,
  makeSnippetToggleCommand,
  parseSnippetToggleCommandId,
  snippetToggleCommandId,
} from "./snippetCommands";
import {
  applyListing,
  enabledSnippetNames,
  getSnippetsState,
  reloadSnippets,
  resetSnippetsForTests,
  setSnippetSource,
  snippetsOutOfDate,
  toggleSnippet,
  type SnippetListing,
} from "./store";

const doc = document;
const win = window;

const row = (id: string, css: string | null, error: string | null = null) =>
  ({ id, path: `/c/snippets/${id}.css`, css, error } as SnippetListing);

const styles = () =>
  Array.from(doc.querySelectorAll("style[data-vault-snippet]")).map((el) => [
    el.getAttribute("data-vault-snippet"),
    el.textContent,
  ]);

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  updatePreferences({ snippets: [] }, win);
});

afterEach(() => {
  applySnippetCss(doc, []);
  resetSnippetsForTests();
  updatePreferences({ snippets: [] }, win);
});

describe("applySnippetCss (style element fallback)", () => {
  it("adds one style per snippet in order", () => {
    applySnippetCss(doc, [
      { id: "a", css: "a{}" },
      { id: "b", css: "b{}" },
    ]);
    expect(styles()).toEqual([
      ["a", "a{}"],
      ["b", "b{}"],
    ]);
    expect(appliedSnippetCount(doc)).toBe(2);
  });

  it("replaces the previous set", () => {
    applySnippetCss(doc, [{ id: "a", css: "a{}" }]);
    applySnippetCss(doc, [{ id: "b", css: "b{}" }]);
    expect(styles()).toEqual([["b", "b{}"]]);
  });

  it("an empty list removes everything", () => {
    applySnippetCss(doc, [{ id: "a", css: "a{}" }]);
    expect(applySnippetCss(doc, [])).toEqual({});
    expect(appliedSnippetCount(doc)).toBe(0);
  });

  it("a theme <style> applied later still lands before the snippets", () => {
    applySnippetCss(doc, [{ id: "a", css: "a{}" }]);
    const handle = applyThemeTokens(doc, {}, { "--x": "1" });
    const order = Array.from(doc.head.querySelectorAll("style")).map(
      (el) => el.id || el.getAttribute("data-vault-snippet"),
    );
    expect(order.indexOf("vault-theme-excalidraw-vars")).toBeLessThan(
      order.indexOf("a"),
    );
    handle.restore();
  });
});

describe("applySnippetCss (adoptedStyleSheets)", () => {
  class FakeSheet {
    css = "";
    replaceSync(css: string) {
      if (css === "THROW") {
        throw new Error("bad css");
      }
      this.css = css;
    }
  }
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(win, "CSSStyleSheet");
    Object.defineProperty(win, "CSSStyleSheet", {
      value: FakeSheet,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(doc, "adoptedStyleSheets", {
      value: [],
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    applySnippetCss(doc, []);
    delete (doc as unknown as Record<string, unknown>).adoptedStyleSheets;
    if (original) {
      Object.defineProperty(win, "CSSStyleSheet", original);
    } else {
      delete (win as unknown as Record<string, unknown>).CSSStyleSheet;
    }
  });

  const adoptedCss = () =>
    (doc.adoptedStyleSheets as unknown as FakeSheet[]).map((s) => s.css);

  it("adopts one sheet per snippet after existing ones and replaces them", () => {
    const theme = new FakeSheet();
    (doc as any).adoptedStyleSheets = [theme];
    applySnippetCss(doc, [
      { id: "a", css: "a{}" },
      { id: "b", css: "b{}" },
    ]);
    expect((doc as any).adoptedStyleSheets[0]).toBe(theme);
    expect(adoptedCss().slice(1)).toEqual(["a{}", "b{}"]);
    expect(styles()).toEqual([]);

    applySnippetCss(doc, [{ id: "c", css: "c{}" }]);
    expect((doc as any).adoptedStyleSheets).toHaveLength(2);
    expect(adoptedCss().slice(1)).toEqual(["c{}"]);

    applySnippetCss(doc, []);
    expect((doc as any).adoptedStyleSheets).toEqual([theme]);
    expect(appliedSnippetCount(doc)).toBe(0);
  });

  it("reports a failing sheet and skips it", () => {
    const errors = applySnippetCss(doc, [
      { id: "bad", css: "THROW" },
      { id: "ok", css: "ok{}" },
    ]);
    expect(errors).toEqual({ bad: "bad css" });
    expect(adoptedCss()).toEqual(["ok{}"]);
  });

  it("a theme sheet adopted after the snippets is inserted before them", () => {
    applySnippetCss(doc, [{ id: "a", css: "a{}" }]);
    const handle = applyThemeTokens(doc, {}, { "--x": "1" });
    const list = adoptedCss();
    expect(list).toHaveLength(2);
    expect(list[1]).toBe("a{}");
    expect(list[0]).toContain("--x");
    handle.restore();
    expect(adoptedCss()).toEqual(["a{}"]);
  });
});

describe("enabledSnippetNames", () => {
  it("trims, drops blanks and exact duplicates, keeps case variants", () => {
    updatePreferences({ snippets: [" a ", "", "A", "b", "  ", "b"] }, win);
    expect(enabledSnippetNames(win)).toEqual(["a", "A", "b"]);
  });
});

describe("applyListing", () => {
  it("applies enabled snippets in enabled order, case-insensitively", () => {
    const state = applyListing(
      doc,
      ["Two", "one"],
      [row("one", "1{}"), row("two", "2{}"), row("three", null)],
    );
    expect(styles()).toEqual([
      ["two", "2{}"],
      ["one", "1{}"],
    ]);
    expect(state.loaded).toBe(true);
    expect(state.snippets.map((s) => [s.id, s.enabled])).toEqual([
      ["one", true],
      ["two", true],
      ["three", false],
    ]);
    expect(state.missing).toEqual([]);
  });

  it("lists missing names and surfaces row errors; disabled are not applied", () => {
    const state = applyListing(
      doc,
      ["gone", "broken"],
      [row("broken", null, "unreadable"), row("off", null)],
    );
    expect(state.missing).toEqual(["gone"]);
    expect(state.snippets.find((s) => s.id === "broken")?.error).toBe(
      "unreadable",
    );
    expect(styles()).toEqual([]);
  });

  it("registers toggle commands and unregisters them when the listing shrinks", () => {
    applyListing(doc, [], [row("a", null), row("b", null)]);
    expect(getRegisteredCommand("snippets.toggle:a")).toBeDefined();
    expect(getRegisteredCommand("snippets.toggle:b")).toBeDefined();
    applyListing(doc, [], [row("a", null)]);
    expect(getRegisteredCommand("snippets.toggle:a")).toBeDefined();
    expect(getRegisteredCommand("snippets.toggle:b")).toBeUndefined();
    applyListing(doc, [], []);
    expect(getRegisteredCommand("snippets.toggle:a")).toBeUndefined();
  });
});

describe("reloadSnippets / toggleSnippet", () => {
  it("does nothing without a source", async () => {
    await reloadSnippets(doc, win);
    expect(getSnippetsState().loaded).toBe(false);
  });

  it("records a loadError when the source throws", async () => {
    setSnippetSource({
      list: () => Promise.reject(new Error("boom")),
      openDir: async () => {},
    });
    await reloadSnippets(doc, win);
    expect(getSnippetsState().loadError).toContain("boom");
  });

  it("toggle appends, removes and persists", async () => {
    setSnippetSource(new FakeSnippetSource({ a: "a{}", b: "b{}" }));
    await toggleSnippet(doc, win, "a");
    await toggleSnippet(doc, win, "b");
    expect(getPreferences(win).snippets).toEqual(["a", "b"]);
    expect(styles().map((s) => s[0])).toEqual(["a", "b"]);
    await toggleSnippet(doc, win, "A");
    expect(getPreferences(win).snippets).toEqual(["b"]);
    expect(styles().map((s) => s[0])).toEqual(["b"]);
  });

  it("toggle with an explicit state that already holds does nothing", async () => {
    const source = new FakeSnippetSource({ a: "a{}" });
    setSnippetSource(source);
    await toggleSnippet(doc, win, "a", false);
    expect(source.lists).toBe(0);
    await toggleSnippet(doc, win, "a", true);
    const lists = source.lists;
    await toggleSnippet(doc, win, "a", true);
    expect(source.lists).toBe(lists);
    expect(getPreferences(win).snippets).toEqual(["a"]);
  });

  it("only turns on snippets that exist; unknown names can be turned off", async () => {
    setSnippetSource(new FakeSnippetSource({ wide: "w{}" }));
    await expect(toggleSnippet(doc, win, "typo")).rejects.toThrow(
      'No snippet named "typo"',
    );
    expect(getPreferences(win).snippets).toEqual([]);
    await toggleSnippet(doc, win, "WIDE");
    expect(getPreferences(win).snippets).toEqual(["wide"]);
    updatePreferences({ snippets: ["wide", "deleted"] }, win);
    await toggleSnippet(doc, win, "deleted");
    expect(getPreferences(win).snippets).toEqual(["wide"]);
  });
});

describe("two files that differ only in case", () => {
  it("both are listed; the exact spelling decides which one is applied", () => {
    const listing = [row("Foo", "upper{}"), row("foo", "lower{}")];
    const state = applyListing(doc, ["foo"], listing);
    expect(state.snippets.map((s) => [s.id, s.enabled])).toEqual([
      ["Foo", false],
      ["foo", true],
    ]);
    expect(styles()).toEqual([["foo", "lower{}"]]);
    expect(getRegisteredCommand("snippets.toggle:Foo")).toBeDefined();
    expect(getRegisteredCommand("snippets.toggle:foo")).toBeDefined();
    const both = applyListing(doc, ["Foo", "foo"], listing);
    expect(both.snippets.every((s) => s.enabled)).toBe(true);
    expect(styles()).toEqual([
      ["Foo", "upper{}"],
      ["foo", "lower{}"],
    ]);
  });

  it("another case still finds the file; one file is applied once", () => {
    applyListing(doc, ["FOO", "foo"], [row("foo", "x{}")]);
    expect(styles()).toEqual([["foo", "x{}"]]);
  });

  it("toggling one spelling leaves the other alone", async () => {
    setSnippetSource(new FakeSnippetSource({ Foo: "u{}", foo: "l{}" }));
    await toggleSnippet(doc, win, "Foo");
    await toggleSnippet(doc, win, "foo");
    expect(getPreferences(win).snippets).toEqual(["Foo", "foo"]);
    await toggleSnippet(doc, win, "Foo");
    expect(getPreferences(win).snippets).toEqual(["foo"]);
    expect(styles()).toEqual([["foo", "l{}"]]);
  });
});

describe("one listing per change, retry after a failure", () => {
  it("a toggle lists the folder once, with the preferences listener running", async () => {
    const source = new FakeSnippetSource({ a: "a{}", b: "b{}" });
    setSnippetSource(source);
    const stop = startSnippets(doc, win, { idle: () => () => {} });
    await toggleSnippet(doc, win, "a");
    await flush();
    const afterFirst = source.lists;
    await toggleSnippet(doc, win, "b");
    await flush();
    // Turning on a (folder not yet listed) costs two; later toggles one.
    expect(afterFirst).toBe(2);
    expect(source.lists - afterFirst).toBe(1);
    await toggleSnippet(doc, win, "b");
    await flush();
    expect(source.lists - afterFirst).toBe(2);
    stop();
  });

  it("a toggle without the listener lists once", async () => {
    const source = new FakeSnippetSource({ a: "a{}" });
    setSnippetSource(source);
    await reloadSnippets(doc, win);
    const base = source.lists;
    await toggleSnippet(doc, win, "a");
    expect(source.lists - base).toBe(1);
  });

  it("a failed listing is asked again on the next change", async () => {
    updatePreferences({ snippets: ["a"] }, win);
    const source = new FakeSnippetSource({ a: "a{}" });
    let fail = true;
    setSnippetSource({
      list: (enabled) =>
        fail ? Promise.reject(new Error("busy")) : source.list(enabled),
      openDir: async () => {},
    });
    const stop = startSnippets(doc, win, { idle: () => () => {} });
    await reloadSnippets(doc, win);
    expect(getSnippetsState().loadError).toContain("busy");
    expect(snippetsOutOfDate(win)).toBe(true);
    fail = false;
    win.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT));
    await flush();
    expect(getSnippetsState().loadError).toBeNull();
    expect(styles()).toEqual([["a", "a{}"]]);
    expect(snippetsOutOfDate(win)).toBe(false);
    stop();
  });
});

describe("waitAtMost", () => {
  it("resolves true when the promise settles in time, even on rejection", async () => {
    expect(await waitAtMost(Promise.resolve(1), 1000)).toBe(true);
    expect(await waitAtMost(Promise.reject(new Error("x")), 1000)).toBe(true);
  });

  it("gives up after the time and leaves the promise running", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise(() => {});
      const result = waitAtMost(never, 150);
      await vi.advanceTimersByTimeAsync(149);
      let settled = false;
      void result.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("snippet command ids", () => {
  it("parses ids", () => {
    expect(parseSnippetToggleCommandId("snippets.toggle:my css")).toBe(
      "my css",
    );
    expect(parseSnippetToggleCommandId("snippets.toggle:")).toBeNull();
    expect(parseSnippetToggleCommandId("snippets.reload")).toBeNull();
    expect(snippetToggleCommandId("x")).toBe("snippets.toggle:x");
    expect(makeSnippetToggleCommand("x").title).toBe("CSS snippets: Toggle x");
  });

  it("a [hotkeys]-bound toggle is a command before the folder is listed", () => {
    const overrides = { "snippets.toggle:dark": ["Mod+Alt+D"] } as any;
    expect(isCommandId("snippets.toggle:dark")).toBe(true);
    expect(getCommand("snippets.toggle:dark")?.id).toBe("snippets.toggle:dark");
    expect(boundSnippetToggleCommands(overrides).map((c) => c.id)).toEqual([
      "snippets.toggle:dark",
    ]);
    expect(allCommands(overrides).map((c) => c.id)).toContain(
      "snippets.toggle:dark",
    );
    expect(allCommands({}).map((c) => c.id)).not.toContain(
      "snippets.toggle:dark",
    );
  });

  it("a bound toggle differing only in case replaces the registered one", () => {
    applyListing(doc, [], [row("Wide", null)]);
    const overrides = {
      "snippets.toggle:wide": ["Mod+W"],
      "snippets.toggle:WIDE": ["Mod+Alt+W"],
    } as any;
    const ids = allCommands(overrides)
      .map((c) => c.id)
      .filter((id) => id.toLowerCase() === "snippets.toggle:wide");
    expect(ids).toHaveLength(1);
    expect(overrides[ids[0]]).toBeDefined();
  });

  it("registered toggles are not duplicated by allCommands", () => {
    applyListing(doc, [], [row("dark", null)]);
    const ids = allCommands({ "snippets.toggle:dark": ["Mod+D"] } as any).map(
      (c) => c.id,
    );
    expect(ids.filter((id) => id === "snippets.toggle:dark")).toHaveLength(1);
  });
});

describe("touchesSnippets / touchesConfigSubdir", () => {
  it("without a known root, matches a snippets/ path segment", () => {
    expect(touchesSnippets(["/c/snippets/a.css"], null)).toBe(true);
    expect(touchesSnippets(["C:\\c\\snippets\\a.css"], null)).toBe(true);
    expect(touchesSnippets(["/c/config.toml", "/c/snippets"], null)).toBe(true);
    expect(touchesSnippets(["/c/config.toml", "/c/themes/x.json"], null)).toBe(
      false,
    );
    expect(touchesSnippets(["/c/mysnippets/a.css"], null)).toBe(false);
    expect(touchesSnippets([1], null)).toBe(false);
  });

  it("is anchored to the config root", () => {
    const root = "/Users/me/.config/vaultdraw";
    expect(touchesSnippets([`${root}/snippets/a.css`], root)).toBe(true);
    expect(touchesSnippets([`${root}/SNIPPETS`], root)).toBe(true);
    expect(touchesSnippets([`${root}/themes/snippets/x.json`], root)).toBe(
      false,
    );
    expect(touchesSnippets([`${root}/snippets.bak/a.css`], root)).toBe(false);
    expect(touchesSnippets(["/other/themes/a.json"], root)).toBe(false);
    // The watcher reports the root itself when it can't tell what changed.
    expect(touchesSnippets([root], root)).toBe(true);
    expect(touchesSnippets([`${root}/`], root)).toBe(true);
    expect(
      touchesConfigSubdir(["C:\\Cfg\\Themes\\x.json"], "themes", "C:\\cfg"),
    ).toBe(true);
  });

  it("matches other spellings of the same config folder", () => {
    const root = "/var/folders/ab/T/cfg";
    // The watcher reports the canonical path (macOS /var is /private/var).
    expect(
      touchesSnippets([`/private/var/folders/ab/T/cfg/snippets/a.css`], root),
    ).toBe(true);
    expect(touchesSnippets(["/private/var/folders/ab/T/cfg"], root)).toBe(true);
    expect(
      touchesSnippets(["/private/var/folders/ab/T/cfg/themes/x.json"], root),
    ).toBe(false);
    // A symlinked config folder: the watcher reports the target.
    expect(
      touchesSnippets(
        ["/Volumes/data/dots/vaultdraw/snippets/a.css"],
        "/Users/me/.config/vaultdraw",
      ),
    ).toBe(true);
    // Windows verbatim prefix and drive-letter case.
    expect(
      touchesConfigSubdir(
        ["\\\\?\\C:\\Cfg\\snippets\\a.css"],
        "snippets",
        "c:\\cfg",
      ),
    ).toBe(true);
  });

  it("a snippets folder elsewhere in a foreign path still matches by segment", () => {
    expect(
      touchesSnippets(
        ["/anything/at/all/snippets/a.css"],
        "/Users/me/.config/vaultdraw",
      ),
    ).toBe(true);
    expect(
      touchesSnippets(
        ["/anything/at/all/other/a.css"],
        "/Users/me/.config/vaultdraw",
      ),
    ).toBe(false);
  });

  it("treats an unknown or empty batch as a change", () => {
    expect(touchesSnippets(undefined, null)).toBe(true);
    expect(touchesSnippets([], "/c")).toBe(true);
  });
});

describe("startSnippets", () => {
  const setup = () => {
    const source = new FakeSnippetSource({ a: "a{}", b: "b{}" });
    setSnippetSource(source);
    let configHandler: ((e: { payload: unknown }) => void) | null = null;
    const off = vi.fn();
    const listen = vi.fn(async (_event: string, h: any) => {
      configHandler = h;
      return off;
    });
    let idleRun: (() => void) | null = null;
    const idleCancel = vi.fn();
    const idle = vi.fn((run: () => void) => {
      idleRun = run;
      return idleCancel;
    });
    return {
      source,
      listen,
      idle,
      off,
      idleCancel,
      fireConfig: (paths: string[]) => configHandler?.({ payload: { paths } }),
      runIdle: () => idleRun?.(),
    };
  };

  it("is a no-op without a source", () => {
    const idle = vi.fn(() => () => {});
    const stop = startSnippets(doc, win, { idle });
    expect(idle).not.toHaveBeenCalled();
    expect(getRegisteredHandler("snippets.reload")).toBeUndefined();
    stop();
  });

  it("lists once when idle and binds the commands", async () => {
    const t = setup();
    const stop = startSnippets(doc, win, { listen: t.listen, idle: t.idle });
    await flush();
    expect(t.source.lists).toBe(0);
    t.runIdle();
    await flush();
    expect(t.source.lists).toBe(1);
    expect(getSnippetsState().snippets.map((s) => s.id)).toEqual(["a", "b"]);
    await getRegisteredHandler("snippets.reload")!();
    expect(t.source.lists).toBe(2);
    await getRegisteredHandler("snippets.openFolder")!();
    expect(t.source.opened).toBe(1);
    await getRegisteredHandler("snippets.toggle:a")!();
    expect(getPreferences(win).snippets).toEqual(["a"]);
    stop();
    expect(t.off).toHaveBeenCalled();
    expect(t.idleCancel).toHaveBeenCalled();
    expect(getRegisteredHandler("snippets.reload")).toBeUndefined();
  });

  it("reloads on a preferences change only when the list changed", async () => {
    const t = setup();
    const stop = startSnippets(doc, win, { listen: t.listen, idle: t.idle });
    await flush();
    win.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
    await flush();
    expect(t.source.lists).toBe(0);
    updatePreferences({ snippets: ["a"] }, win);
    win.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
    await flush();
    expect(t.source.lists).toBe(1);
    win.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
    await flush();
    expect(t.source.lists).toBe(1);
    stop();
    updatePreferences({ snippets: ["b"] }, win);
    win.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
    await flush();
    expect(t.source.lists).toBe(1);
  });

  it("a Settings toggle then a hand edit removing it reloads (no stale key)", async () => {
    const t = setup();
    const stop = startSnippets(doc, win, { listen: t.listen, idle: t.idle });
    t.runIdle();
    await flush();
    // Settings calls the store directly, not through boot.
    await toggleSnippet(doc, win, "a", true);
    expect(styles().map((x) => x[0])).toEqual(["a"]);
    // config.toml edited by hand: the snippet is removed again.
    updatePreferences({ snippets: [] }, win);
    win.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
    await flush();
    expect(styles()).toEqual([]);
    stop();
  });

  it("reloads on config-change only when snippets/ was touched", async () => {
    const t = setup();
    const stop = startSnippets(doc, win, { listen: t.listen, idle: t.idle });
    await flush();
    expect(t.listen).toHaveBeenCalledWith(
      "config-change",
      expect.any(Function),
    );
    t.fireConfig(["/c/config.toml"]);
    await flush();
    expect(t.source.lists).toBe(0);
    t.fireConfig(["/c/snippets/a.css"]);
    await flush();
    expect(t.source.lists).toBe(1);
    stop();
  });
});

describe("appearance.snippets config key", () => {
  it("parses a list of names", () => {
    const { values, problems } = configToPreferences({
      appearance: { snippets: ["a", "b"] },
    });
    expect(values.snippets).toEqual(["a", "b"]);
    expect(problems.filter((p) => p.key === "appearance.snippets")).toEqual([]);
  });

  it("defaults to [] when absent", () => {
    expect(configToPreferences({}).values.snippets).toEqual([]);
  });

  it("falls back to [] with a problem for a bad value", () => {
    const { values, problems } = configToPreferences({
      appearance: { snippets: 3 },
    });
    expect(values.snippets).toEqual([]);
    expect(problems.map((p) => p.key)).toContain("appearance.snippets");
  });
});
