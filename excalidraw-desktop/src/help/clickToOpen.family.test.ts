import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createOnLinkOpen } from "../editor/links/onLinkOpen";
import { toastStore } from "../toasts/toastStore";

import { isWebLink, openWebLink } from "./openExternal";

/**
 * Family sweep (bug hunt BH-2): every click that opens a web link (note links, canvas shape
 * links, help commands, Settings links) reaches the native opener, plain http included, and a
 * failure is shown, never swallowed. The Settings members are clicked in
 * e2e/families/external-links.spec.ts; this covers the code paths and guards the pattern.
 */
const SRC = join(__dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "tests" ? [] : walk(full);
    }
    return /\.tsx?$/.test(full) && !/\.test\./.test(full) ? [full] : [];
  });

describe("click-to-open web links", () => {
  it("no caller swallows an opener failure (silent .catch or a bare void call)", () => {
    const opener = /\b(openExternal|openBugReport|openFeatureRequest)\(/;
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (f.endsWith(join("help", "openExternal.ts"))) {
        continue;
      }
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (
            opener.test(line) &&
            (/\.catch\(\(\) => \{\}\)/.test(line) ||
              (/\bvoid\s+(openExternal|openBugReport|openFeatureRequest)\(/.test(
                line,
              ) &&
                !/\.catch\(/.test(line)))
          ) {
            offenders.push(`${f.replace(SRC, "src")}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    ["https://example.com", true],
    ["http://example.com/old", true],
    ["  HTTP://EXAMPLE.COM  ", true],
    ["mailto:a@b.c", true],
    ["  MAILTO:a@b.c?subject=Hi  ", true],
    ["tel:123", false],
    ["Notes/Idea", false],
    ["/Notes/Idea", false],
  ])("isWebLink(%j) is %s", (url, web) => {
    expect(isWebLink(url)).toBe(web);
  });

  it.each([
    ["https://example.com/a", "web"],
    ["http://example.com/old", "web"],
    ["[[Idea]]", "vault"],
    ["mailto:a@b.c", "web"],
    ["tel:123", "left"],
  ])("a canvas shape link %j opens as %s", (link, expected) => {
    const openRaw = vi.fn((raw: string) => raw.startsWith("[["));
    const openWeb = vi.fn();
    const event = { preventDefault: vi.fn() };
    createOnLinkOpen(openRaw, openWeb)({ link }, event);
    const got = openWeb.mock.calls.length
      ? "web"
      : openRaw.mock.results.some((r) => r.value)
      ? "vault"
      : "left";
    expect(got).toBe(expected);
    expect(event.preventDefault).toHaveBeenCalledTimes(got === "left" ? 0 : 1);
    if (got === "web") {
      expect(openWeb).toHaveBeenCalledWith(link);
    }
  });

  it("a refused or failed open shows a notice naming the link", async () => {
    const push = vi.spyOn(toastStore, "push");
    await openWebLink("http://example.com", {
      open: () => Promise.reject(new Error("No browser")),
    });
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "error",
        message: "Couldn't open http://example.com: No browser",
      }),
    );
    push.mockRestore();
  });
});
