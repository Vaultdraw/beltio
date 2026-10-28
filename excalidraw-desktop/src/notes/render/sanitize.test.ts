// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { sanitizeNoteHtml } from "./sanitize";

const anchor = (href: string) => {
  const host = document.createElement("div");
  host.innerHTML = sanitizeNoteHtml(`<a href="${href}">link</a>`, {
    remoteImages: false,
  } as never);
  return host.querySelector("a")!;
};

describe("note links the app opens outside itself", () => {
  it.each([
    "https://example.com/a",
    "http://example.com/old",
    "mailto:a@b.c",
    "mailto:a@b.c?subject=Hello",
  ])("%s is marked for the opener (toimprove 101)", (href) => {
    const a = anchor(href);
    expect(a.getAttribute("href")).toBe(href);
    expect(a.dataset.external).toBe("1");
  });

  it.each(["javascript:alert(1)", "tel:123", "#heading"])(
    "%s is not marked",
    (href) => {
      expect(anchor(href).dataset.external).toBeUndefined();
    },
  );
});
