import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import fixture from "../../src-tauri/crates/vaultdraw-protocol/tests/fixtures/scene-version.json";
import { makeElements } from "../sceneOps/testUtils";

import { cyrb53, hashScene, sceneVersion } from "./sceneVersion";

describe("sceneVersion", () => {
  it.each(fixture.cases)("fixture: $name", ({ elements, version }) => {
    expect(hashScene(elements)).toBe(version);
  });

  it("cyrb53 stays inside 53 bits and is deterministic", () => {
    const h = cyrb53("a\u00001\u0001");
    expect(h).toBe(cyrb53("a\u00001\u0001"));
    expect(h).toBeLessThan(2 ** 53);
    expect(cyrb53("a")).not.toBe(cyrb53("b"));
  });

  it("deleted elements do not change it, live ones do", () => {
    const els = makeElements(3);
    const base = sceneVersion(els);
    const withDeleted = [
      ...els,
      { ...els[0], id: "gone", version: 9, isDeleted: true },
    ] as ExcalidrawElement[];
    expect(sceneVersion(withDeleted)).toBe(base);
    const edited = els.map((e, i) =>
      i === 1 ? { ...e, version: e.version + 1 } : e,
    ) as ExcalidrawElement[];
    expect(sceneVersion(edited)).not.toBe(base);
    expect(base).toMatch(/^s[0-9a-z]+$/);
  });

  it("caches on array identity and scene version", () => {
    const els = makeElements(5);
    const a = sceneVersion(els);
    expect(sceneVersion(els)).toBe(a);
    // In-place mutation (a drag) bumps the scene version, so the hash is recomputed.
    (els[2] as { version: number }).version += 1;
    expect(sceneVersion(els)).not.toBe(a);
  });
});
