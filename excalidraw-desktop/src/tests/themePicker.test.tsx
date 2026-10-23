import { afterEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  filterThemes,
  ThemePicker,
  themeEntryName,
} from "../components/ThemePicker";
import { builtinRegistry, type ThemeEntry } from "../theme/registry";

const base = builtinRegistry().themes;

/**
 * n fake entries named "Theme 001"…, shaped like the lazy registry: cheap
 * fields, a counting `summary` getter (preview colours) and a counting
 * `theme` getter (a full parse, which the picker must never trigger).
 */
const lazyThemes = (n: number) => {
  const summaryReads = new Set<string>();
  const themeReads = new Set<string>();
  const entries = Array.from({ length: n }, (_, i) => {
    const src = base[i % base.length];
    const name = `Theme ${String(i + 1).padStart(3, "0")}`;
    const id = `theme-${String(i + 1).padStart(3, "0")}`;
    const fields = {
      key: name,
      id,
      name,
      source: "builtin" as const,
      origin: src.origin,
      path: null,
      warnings: [],
      overridesBuiltin: false,
    };
    const summary = { ...fields, preview: src.summary.preview };
    return Object.defineProperties(fields, {
      theme: {
        get: () => {
          themeReads.add(name);
          return src.theme;
        },
      },
      summary: {
        get: () => {
          summaryReads.add(name);
          return summary;
        },
      },
    }) as unknown as ThemeEntry;
  });
  return { entries, summaryReads, themeReads };
};

const manyThemes = (n: number) => lazyThemes(n).entries;

const radios = () => screen.getAllByRole("radio");
const names = () => radios().map((r) => r.getAttribute("aria-label"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filterThemes", () => {
  it("matches theme names case-insensitively and ignores surrounding blanks", () => {
    expect(filterThemes(base, "  KANAGAWA ").map(themeEntryName)).toEqual([
      "Kanagawa",
    ]);
    expect(filterThemes(base, "")).toBe(base);
    expect(filterThemes(base, "zzz")).toEqual([]);
  });
});

describe("ThemePicker", () => {
  it("renders 120 themes, filters them and shows an empty state", () => {
    const { entries: themes, themeReads } = lazyThemes(120);
    render(
      <ThemePicker
        themes={themes}
        selectedKey="Theme 001"
        onSelect={() => {}}
      />,
    );
    expect(radios()).toHaveLength(120);
    const search = screen.getByRole("searchbox", {
      name: "Search colour themes",
    });
    expect(search).toHaveAttribute("placeholder", "Search themes");
    expect(screen.getByText(/^120 ·/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "theme 11" } });
    expect(names()).toEqual(
      Array.from({ length: 10 }, (_, i) => `Theme 11${i}`),
    );
    expect(screen.getByRole("status")).toHaveTextContent("10 themes");

    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(/No themes match/)).toBeInTheDocument();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(radios()).toHaveLength(120);
    // Listing, filtering and previews never parse a theme.
    expect(themeReads.size).toBe(0);
  });

  it("selects on click, with a single tab stop on the selected card", () => {
    const onSelect = vi.fn();
    const themes = manyThemes(20);
    render(
      <ThemePicker
        themes={themes}
        selectedKey="Theme 005"
        onSelect={onSelect}
      />,
    );
    const selected = screen.getByRole("radio", { name: "Theme 005" });
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(radios().filter((r) => r.tabIndex === 0)).toEqual([selected]);

    fireEvent.click(screen.getByRole("radio", { name: "Theme 007" }));
    expect(onSelect).toHaveBeenCalledWith(themes[6]);
    expect(onSelect.mock.calls[0][0].summary.key).toBe("Theme 007");

    // Selected card filtered out: the first match takes the tab stop.
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "theme 01" },
    });
    expect(radios().filter((r) => r.tabIndex === 0)).toEqual([
      screen.getByRole("radio", { name: "Theme 010" }),
    ]);
  });

  it("moves focus with the arrow keys, Home and End (three per row)", () => {
    render(
      <ThemePicker
        themes={manyThemes(10)}
        selectedKey="Theme 001"
        onSelect={() => {}}
      />,
    );
    const card = (n: number) =>
      screen.getByRole("radio", {
        name: `Theme ${String(n).padStart(3, "0")}`,
      });
    card(1).focus();
    fireEvent.keyDown(card(1), { key: "ArrowRight" });
    expect(card(2)).toHaveFocus();
    fireEvent.keyDown(card(2), { key: "ArrowDown" });
    expect(card(5)).toHaveFocus();
    fireEvent.keyDown(card(5), { key: "ArrowUp" });
    expect(card(2)).toHaveFocus();
    fireEvent.keyDown(card(2), { key: "End" });
    expect(card(10)).toHaveFocus();
    fireEvent.keyDown(card(10), { key: "ArrowDown" });
    expect(card(10)).toHaveFocus();
    fireEvent.keyDown(card(10), { key: "Home" });
    expect(card(1)).toHaveFocus();

    // ArrowDown in the search field jumps into the grid.
    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(card(1)).toHaveFocus();
  });

  it("does not re-render cards when only the parent's onSelect changes", () => {
    const { entries, summaryReads, themeReads } = lazyThemes(30);
    const { rerender } = render(
      <ThemePicker
        themes={entries}
        selectedKey="Theme 001"
        onSelect={() => {}}
      />,
    );
    // No IntersectionObserver in jsdom: every preview renders once, from
    // the cheap summary; no theme is resolved.
    expect(summaryReads.size).toBe(30);
    expect(themeReads.size).toBe(0);
    summaryReads.clear();
    rerender(
      <ThemePicker
        themes={entries}
        selectedKey="Theme 001"
        onSelect={() => {}}
      />,
    );
    expect(summaryReads.size).toBe(0);
  });

  it("defers previews (and lazy summaries) until a card is near view", () => {
    let callback: IntersectionObserverCallback = () => {};
    const observed = new Set<Element>();
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.add(el);
      }
      unobserve(el: Element) {
        observed.delete(el);
      }
      disconnect() {
        observed.clear();
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    const { entries, summaryReads, themeReads } = lazyThemes(100);
    render(
      <ThemePicker
        themes={entries}
        selectedKey="Theme 050"
        onSelect={() => {}}
      />,
    );
    // Names come from the entry, not the resolved theme.
    expect(radios()).toHaveLength(100);
    expect(summaryReads.size).toBe(0);
    expect(observed.size).toBe(100);

    const target = screen.getByRole("radio", { name: "Theme 050" });
    act(() => {
      callback(
        [
          {
            isIntersecting: true,
            target,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect([...summaryReads]).toEqual(["Theme 050"]);
    expect(themeReads.size).toBe(0);
    expect(target.querySelectorAll(".vault-theme-card__half")).toHaveLength(2);
    expect(observed.has(target)).toBe(false);
    expect(
      screen
        .getByRole("radio", { name: "Theme 051" })
        .querySelectorAll(".vault-theme-card__half"),
    ).toHaveLength(0);
  });
});
