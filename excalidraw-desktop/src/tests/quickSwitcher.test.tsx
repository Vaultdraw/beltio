import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordRecent } from "../palette/recent";
import { updatePreferences } from "../vault/preferences";
import { QuickSwitcher } from "../components/QuickSwitcher";

import type { QuickSwitcherProps } from "../components/QuickSwitcher";
import type { PaletteItem } from "../palette/types";
import type { IndexStatus, NamesListing } from "../search/types";

const status = (total: number, state: IndexStatus["state"] = "ready") => ({
  handle: "h",
  state,
  indexed: total,
  total,
});

const fakeSearch = (
  paths: string[],
  listing?: Partial<NamesListing> | Error,
) => ({
  listNames: vi.fn(async (): Promise<NamesListing> => {
    if (listing instanceof Error) {
      throw listing;
    }
    return { paths, status: status(paths.length), ...listing };
  }),
  subscribe: vi.fn(async () => () => {}),
});

const PATHS = [
  "Archive/old-notes.excalidraw",
  "Projects/vault-design.excalidraw",
  "Projects/roadmap.excalidraw",
  "sketch.excalidraw",
];
const mkItem = (
  key: string,
  title: string,
  extra: Partial<PaletteItem> = {},
): PaletteItem => ({ key, title, group: "App", run: vi.fn(), ...extra });

const makeItems = (): PaletteItem[] => [
  mkItem("command:settings.open", "Open settings", { shortcut: "⌘," }),
  mkItem("command:view.toggleNavigator", "Toggle navigator", {
    keywords: ["sidebar"],
  }),
  mkItem("command:vault.newDrawing", "New drawing"),
  mkItem("theme:Dracula", "Theme: Dracula", { group: "Appearance" }),
  mkItem("theme:Nord", "Theme: Nord", { group: "Appearance", checked: true }),
];

const setup = async (props: Partial<QuickSwitcherProps> = {}) => {
  const handlers = {
    onOpenDrawing: vi.fn(),
    onRunItem: vi.fn(),
    onClose: vi.fn(),
  };
  const collectItems = vi.fn(makeItems);
  render(
    <QuickSwitcher
      search={fakeSearch(PATHS)}
      handle="h"
      collectItems={collectItems}
      platform="mac"
      ownerDocument={document}
      {...handlers}
      {...props}
    />,
  );
  await act(async () => {});
  return { ...handlers, collectItems };
};

const input = () => screen.getByRole("combobox");
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(input(), { key: k, ...init });
const options = () => screen.getAllByRole("option");
const active = () =>
  options().findIndex((o) => o.getAttribute("aria-selected") === "true");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("QuickSwitcher", () => {
  it("files mode: focuses the input and lists drawings only", async () => {
    const h = await setup();
    expect(input()).toHaveFocus();
    expect(input()).toHaveValue("");
    expect(input()).toHaveAccessibleName("Go to drawing");
    expect(input()).toHaveAttribute(
      "placeholder",
      expect.stringContaining("drawings"),
    );
    expect(options()).toHaveLength(PATHS.length);
    expect(options()[0]).toHaveTextContent("old-notes");
    expect(screen.queryByText("Open settings")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Command palette");
    // Files mode never asks the providers.
    type("open");
    expect(h.collectItems).not.toHaveBeenCalled();
  });

  it("commands mode: opens with '>' and lists items only", async () => {
    const h = await setup({ initialMode: "commands" });
    expect(input()).toHaveValue(">");
    expect(input()).toHaveAccessibleName("Run a command");
    expect(screen.getByText(/Search commands/)).toBeInTheDocument();
    expect(options()).toHaveLength(makeItems().length);
    expect(screen.getByText("⌘,")).toBeInTheDocument();
    expect(h.collectItems).toHaveBeenCalledTimes(1);
  });

  it("typing '>' switches to commands, deleting it switches back", async () => {
    const h = await setup();
    type(">");
    expect(input()).toHaveAccessibleName("Run a command");
    expect(options()).toHaveLength(makeItems().length);
    type(">op");
    expect(options()[0]).toHaveTextContent("Open settings");
    type("op");
    expect(input()).toHaveAccessibleName("Go to drawing");
    expect(screen.queryByText("Open settings")).toBeNull();
    type(">");
    // Collected once, the first time commands mode showed.
    expect(h.collectItems).toHaveBeenCalledTimes(1);
  });

  it("the same mode's shortcut closes, the other mode's switches", async () => {
    const h = await setup();
    const cmdShiftP = { code: "KeyP", metaKey: true, shiftKey: true };
    const cmdP = { code: "KeyP", metaKey: true };
    type("road");
    key("P", cmdShiftP);
    expect(input()).toHaveValue(">");
    expect(h.onClose).not.toHaveBeenCalled();
    key("p", cmdP);
    expect(input()).toHaveValue("");
    expect(h.onClose).not.toHaveBeenCalled();
    key("/", { code: "Slash", metaKey: true });
    expect(input()).toHaveValue(">");
    key("/", { code: "Slash", metaKey: true });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("follows rebinds of both mode shortcuts, including the legacy id", async () => {
    updatePreferences(
      { hotkeys: { "palette.quickSwitcher": ["Mod+K"] } },
      window,
    );
    const h = await setup();
    key("p", { code: "KeyP", metaKey: true });
    expect(h.onClose).not.toHaveBeenCalled();
    key("P", { code: "KeyP", metaKey: true, shiftKey: true });
    expect(input()).toHaveValue(">");
    key("k", { code: "KeyK", metaKey: true });
    expect(input()).toHaveValue("");
    key("k", { code: "KeyK", metaKey: true });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("ranks the fuzzy match first and Enter opens it", async () => {
    const h = await setup();
    type("vdg");
    expect(options()[0]).toHaveTextContent("vault-design");
    expect(input()).toHaveAttribute("aria-activedescendant", options()[0].id);
    key("Enter");
    expect(h.onOpenDrawing).toHaveBeenCalledWith(
      "Projects/vault-design.excalidraw",
    );
  });

  it("files mode lists no commands for the same query", async () => {
    await setup({
      search: fakeSearch(["Notes/open-roadmap-settings.excalidraw", ...PATHS]),
    });
    type("open");
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("open-roadmap");
    type(">open");
    expect(options()[0]).toHaveTextContent("Open settings");
    expect(options().some((o) => o.textContent?.includes("open-roadmap"))).toBe(
      false,
    );
  });

  it('">" lists items only and Enter runs one (keepOpen false)', async () => {
    const h = await setup();
    type(">");
    expect(options()).toHaveLength(makeItems().length);
    type(">toggle");
    key("Enter");
    expect(h.onRunItem).toHaveBeenCalledTimes(1);
    expect(h.onRunItem.mock.calls[0][0].key).toBe(
      "command:view.toggleNavigator",
    );
    expect(h.onRunItem.mock.calls[0][1]).toBe(false);
    expect(h.onOpenDrawing).not.toHaveBeenCalled();
  });

  it("Tab drills into the family and swallows Tab otherwise", async () => {
    await setup();
    type(">dracula");
    key("Tab");
    expect(input()).toHaveValue(">Theme: ");
    expect(options()).toHaveLength(2);
    type("sketch");
    key("Tab");
    expect(input()).toHaveValue("sketch");
  });

  it("ArrowRight drills only with the caret at the end", async () => {
    await setup();
    type(">dracula");
    (input() as HTMLInputElement).setSelectionRange(2, 2);
    key("ArrowRight");
    expect(input()).toHaveValue(">dracula");
    (input() as HTMLInputElement).setSelectionRange(8, 8);
    key("ArrowRight");
    expect(input()).toHaveValue(">Theme: ");
  });

  it("Mod+Enter runs in place, re-collects and keeps query and row", async () => {
    vi.useFakeTimers();
    try {
      const h = await setup();
      type(">theme");
      const activeKeyText = () => options()[active()].textContent;
      key("ArrowDown");
      const before = activeKeyText();
      key("Enter", { metaKey: true });
      expect(h.onRunItem).toHaveBeenCalledWith(
        expect.objectContaining({ key: expect.stringMatching(/^theme:/) }),
        true,
      );
      expect(h.collectItems).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(h.collectItems).toHaveBeenCalledTimes(2);
      expect(input()).toHaveValue(">theme");
      expect(activeKeyText()).toBe(before);
      expect(h.onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Mod+Enter closes when the command moved focus out of the palette", async () => {
    vi.useFakeTimers();
    try {
      const h = await setup();
      h.onRunItem.mockImplementation(() => {
        const other = document.createElement("button");
        document.body.append(other);
        other.focus();
      });
      type(">settings");
      key("Enter", { metaKey: true });
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(h.onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Mod+Enter on a drawing opens it in a new tab", async () => {
    const h = await setup();
    type("roadm");
    key("Enter", { metaKey: true });
    expect(h.onOpenDrawing).toHaveBeenCalledWith(
      "Projects/roadmap.excalidraw",
      {
        target: "new",
      },
    );
    expect(h.onRunItem).not.toHaveBeenCalled();
  });

  it("lists each mode's recents first on an empty query", async () => {
    recordRecent("drawing:sketch.excalidraw", window);
    recordRecent("theme:Nord", window);
    await setup();
    expect(options()[0]).toHaveTextContent("sketch");
    type(">");
    expect(options()[0]).toHaveTextContent("Theme: Nord");
    expect(options().some((o) => o.textContent?.includes("sketch"))).toBe(
      false,
    );
  });

  it("records what was run as a recent of its mode", async () => {
    await setup();
    type(">new");
    key("Enter");
    type("roadm");
    key("Enter");
    cleanup();
    await setup({ initialMode: "commands" });
    expect(options()[0]).toHaveTextContent("New drawing");
    cleanup();
    await setup();
    expect(options()[0]).toHaveTextContent("roadmap");
  });

  it("matches keywords without showing them", async () => {
    await setup();
    type(">sidebar");
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("Toggle navigator");
    expect(options()[0]).not.toHaveTextContent("sidebar");
  });

  it("marks the checked item", async () => {
    await setup();
    type(">theme: ");
    expect(screen.getAllByRole("img", { name: "Current" })).toHaveLength(1);
    expect(screen.getByText("✓").closest('[role="option"]')).toHaveTextContent(
      "Nord",
    );
  });

  it("wraps with the arrow keys", async () => {
    await setup();
    const n = options().length;
    expect(active()).toBe(0);
    key("ArrowUp");
    expect(active()).toBe(n - 1);
    key("ArrowDown");
    expect(active()).toBe(0);
  });

  it("closes on Escape and on the files chord in files mode", async () => {
    const h = await setup();
    key("Escape");
    expect(h.onClose).toHaveBeenCalledTimes(1);
    key("p", { code: "KeyP", metaKey: true });
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });

  it("falls back to the canvas when the previous element is gone", async () => {
    const editor = document.createElement("div");
    editor.className = "vault-editor";
    const canvas = document.createElement("div");
    canvas.className = "excalidraw-container";
    canvas.tabIndex = 0;
    editor.append(canvas);
    document.body.append(editor);
    await setup();
    key("Escape");
    expect(canvas).toHaveFocus();
    editor.remove();
  });

  it("restores focus to the previous element on close", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    await setup();
    key("Escape");
    expect(button).toHaveFocus();
    button.remove();
  });

  it("shows a message when listing fails but items still work", async () => {
    const h = await setup({ search: fakeSearch([], new Error("boom")) });
    expect(screen.getByRole("status")).toHaveTextContent("boom");
    type(">settings");
    key("Enter");
    expect(h.onRunItem.mock.calls[0][0].key).toBe("command:settings.open");
  });

  it("shows indexing progress with the names known so far", async () => {
    await setup({
      search: fakeSearch(PATHS, {
        status: { ...status(10, "building"), indexed: 4 },
      }),
    });
    expect(screen.getByText("Indexing… 4/10")).toBeInTheDocument();
    expect(options().length).toBeGreaterThan(0);
  });

  it("hover and click pick a row", async () => {
    const h = await setup();
    fireEvent.mouseMove(options()[2]);
    expect(active()).toBe(2);
    fireEvent.click(options()[2]);
    expect(h.onOpenDrawing).toHaveBeenCalledWith("Projects/roadmap.excalidraw");
  });
});

describe("QuickSwitcher keystroke cost (5,000 drawings, jsdom)", () => {
  it("renders a bounded number of rows per keystroke", async () => {
    const paths = Array.from(
      { length: 5000 },
      (_, i) =>
        `Folder${i % 40}/sub${i % 7}/drawing-${i}-${(i * 7919).toString(
          36,
        )}.excalidraw`,
    );
    await setup({ search: fakeSearch(paths) });
    const samples: number[] = [];
    // Count work, not milliseconds: a keystroke renders at most the first
    // paint's rows however many drawings match, and "zq" matches none.
    // Wall-clock budgets live in the perf harness; timing is only logged.
    const counts: Record<string, number> = {};
    for (const q of [
      "d",
      "dr",
      "dra",
      "draw",
      "drawi",
      "f1 dr 12",
      "zq",
      ">",
      ">dr",
      "",
    ]) {
      const t0 = performance.now();
      type(q);
      samples.push(performance.now() - t0);
      counts[q] = screen.queryAllByRole("option").length;
      expect(counts[q]).toBeLessThanOrEqual(24);
    }
    expect(counts.d).toBe(24);
    expect(counts.drawi).toBe(24);
    expect(counts["f1 dr 12"]).toBeGreaterThan(0);
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 =
      samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    console.info(
      `quick switcher keystroke: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(
        1,
      )}ms`,
    );
  });

  it("shows the mode chip and one key legend", async () => {
    await setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".vault-quick__mode")).toHaveTextContent(
      "Drawings",
    );
    expect(dialog.querySelectorAll(".vault-quick__footer")).toHaveLength(1);
    type(">");
    expect(dialog.querySelector(".vault-quick__mode")).toHaveTextContent(
      "Commands",
    );
    expect(dialog.querySelector(".vault-quick__footer")).toHaveTextContent(
      "browse",
    );
  });

  it("groups drawing results and offers a Create row", async () => {
    const h = await setup({ onCreateDrawing: vi.fn() });
    type("roadm");
    const heads = Array.from(
      document.querySelectorAll(".vault-quick__group"),
    ).map((e) => e.textContent);
    expect(heads).toEqual(["Best match", "Create"]);
    expect(options()).toHaveLength(2);
    expect(options()[1]).toHaveTextContent("Create “roadm”");
    key("ArrowDown");
    key("Enter");
    expect(h.onOpenDrawing).not.toHaveBeenCalled();
  });

  it("Create row calls onCreateDrawing with the typed name", async () => {
    const onCreateDrawing = vi.fn();
    await setup({ onCreateDrawing });
    type("fresh idea");
    key("Enter");
    expect(onCreateDrawing).toHaveBeenCalledWith("fresh idea");
  });

  it("has no Create row without a handler, in pick mode or for an exact name", async () => {
    await setup();
    type("zzz");
    expect(screen.queryByText(/Create/)).toBeNull();
    cleanup();
    await setup({ onCreateDrawing: vi.fn(), pickLabel: "Pick" });
    type("zzz");
    expect(screen.queryByText(/Create “/)).toBeNull();
    cleanup();
    await setup({ onCreateDrawing: vi.fn() });
    type("sketch");
    expect(screen.queryByText(/Create “/)).toBeNull();
  });

  it("Family rows browse on Tab and Enter instead of running", async () => {
    const run = vi.fn();
    const family = mkItem("family:theme", "Family: Theme", {
      drill: "Theme: ",
      family: true,
      run,
    });
    await setup({ collectItems: () => [family, ...makeItems()] });
    type(">family");
    expect(options()[0]).toHaveTextContent("Tab browse");
    key("Tab");
    expect(input()).toHaveValue(">Theme: ");
    expect(
      options()
        .map((o) => o.textContent)
        .join(),
    ).toContain("Dracula");
    type(">family");
    key("Enter");
    expect(input()).toHaveValue(">Theme: ");
    expect(run).not.toHaveBeenCalled();
  });
});
