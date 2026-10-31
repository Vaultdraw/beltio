/**
 * Family hunter shell, linux (2026-10-31): "platform words and platform behaviour": a Linux user is
 * never told to use Cmd or Finder, or that something follows macOS (toimprove 287 fixed the Interface
 * page and the palette's Reveal command; the Linux e2e spec looks at two screens only). This sweeps
 * the static text of every setting row and every command title, run under jsdom, whose navigator is
 * not a Mac, so it reads what a Linux user reads. A row that names another system is `it.fails`
 * with its toimprove number. The rule for new text: use `platformWords.ts` (`modKeyWord`,
 * `fileManagerWord`) or say "the system".
 */
import { describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../commands/commands";
import { detectPlatform } from "../commands/keys";
import { SETTINGS_SCHEMA } from "../components/settings/schema";

// jsdom's user agent names the host (darwin on a Mac): say Linux before any module reads it.
vi.hoisted(() => {
  const nav = globalThis.navigator;
  Object.defineProperty(nav, "userAgent", {
    value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15",
    configurable: true,
  });
  Object.defineProperty(nav, "platform", {
    value: "Linux x86_64",
    configurable: true,
  });
});

const MAC_WORDS = /\bCmd\b|⌘|\bFinder\b|\bmacOS\b|\bSpotlight\b|\bOption\b/;

/** Rows that name macOS today, and why each is wrong on Linux. */
const BROKEN: Record<string, string> = {
  "setting:mode":
    'Mode says "follow macOS"; Linux follows the desktop\'s colour scheme too',
  "setting:watchdog-enabled":
    "the Hang watchdog row is on every platform but works on macOS only (it says so; Linux sees a switch that does nothing)",
};

const rows: { id: string; text: string }[] = [
  ...SETTINGS_SCHEMA.map((s) => ({
    id: `setting:${s.id}`,
    text: `${s.label}\n${s.description}\n${s.heading ?? ""}`,
  })),
  ...COMMANDS.map((c) => ({
    id: `command:${c.id}`,
    text: `${c.title}\n${c.category ?? ""}`,
  })),
];

describe("family (linux): static user text never names another system", () => {
  it("sanity: this run is not a Mac", () => {
    expect(detectPlatform()).toBe("linux");
    expect(rows.length).toBeGreaterThan(150);
  });

  it("every broken row listed still exists", () => {
    expect(
      Object.keys(BROKEN).filter((id) => !rows.some((r) => r.id === id)),
    ).toEqual([]);
  });

  it("no unlisted row names macOS, Cmd, Finder, Spotlight or Option", () => {
    expect(
      rows
        .filter((r) => MAC_WORDS.test(r.text) && !BROKEN[r.id])
        .map((r) => r.id),
    ).toEqual([]);
  });

  for (const [id, why] of Object.entries(BROKEN)) {
    it.fails(`${id}: ${why} (toimprove 307)`, () => {
      const row = rows.find((r) => r.id === id)!;
      expect(row.text).not.toMatch(MAC_WORDS);
    });
  }
});
