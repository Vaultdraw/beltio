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

import { touchesSnippets, startSnippets } from "./boot";
import {
  appliedSnippetCount,
  applySnippetCss,
  keepSnippetsLast,
} from "./sheets";
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

  it("keepSnippetsLast is a no-op without adopted sheets", () => {
    applySnippetCss(doc, [{ id: "a", css: "a{}" }]);
    expect(() => keepSnippetsLast(doc)).not.toThrow();
    expect(appliedSnippetCount(doc)).toBe(1);
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

  it("keepSnippetsLast moves ours behind a later-adopted sheet", () => {
    applySnippetCss(doc, [{ id: "a", css: "a{}" }]);
    const later = new FakeSheet();
    later.css = "theme";
    (doc as any).adoptedStyleSheets = [
      ...(doc as any).adoptedStyleSheets,
      later,
    ];
    expect(adoptedCss()).toEqual(["a{}", "theme"]);
    keepSnippetsLast(doc);
    expect(adoptedCss()).toEqual(["theme", "a{}"]);
    const same = (doc as any).adoptedStyleSheets;
    keepSnippetsLast(doc);
    expect((doc as any).adoptedStyleSheets).toBe(same);
  });

  it("keepSnippetsLast is a no-op with none applied", () => {
    const list = [new FakeSheet()];
    (doc as any).adoptedStyleSheets = list;
    keepSnippetsLast(doc);
    expect((doc as any).adoptedStyleSheets).toBe(list);
  });
});

describe("enabledSnippetNames", () => {
  it("trims, drops blanks and case-insensitive duplicates", () => {
    updatePreferences({ snippets: [" a ", "", "A", "b", "  "] }, win);
    expect(enabledSnippetNames(win)).toEqual(["a", "b"]);
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
    await toggleSnippet(doc, win, "a", true);
    expect(source.lists).toBe(1);
    expect(getPreferences(win).snippets).toEqual(["a"]);
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

  it("registered toggles are not duplicated by allCommands", () => {
    applyListing(doc, [], [row("dark", null)]);
    const ids = allCommands({ "snippets.toggle:dark": ["Mod+D"] } as any).map(
      (c) => c.id,
    );
    expect(ids.filter((id) => id === "snippets.toggle:dark")).toHaveLength(1);
  });
});

describe("touchesSnippets", () => {
  it("matches only paths inside snippets/", () => {
    expect(touchesSnippets(["/c/snippets/a.css"])).toBe(true);
    expect(touchesSnippets(["C:\\c\\snippets\\a.css"])).toBe(true);
    expect(touchesSnippets(["/c/config.toml", "/c/snippets"])).toBe(true);
    expect(touchesSnippets(["/c/config.toml", "/c/themes/x.json"])).toBe(false);
    expect(touchesSnippets(["/c/mysnippets/a.css"])).toBe(false);
    expect(touchesSnippets(undefined)).toBe(false);
    expect(touchesSnippets([1])).toBe(false);
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
