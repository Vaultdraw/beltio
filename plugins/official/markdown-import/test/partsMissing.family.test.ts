/**
 * Family (hunter A-6): "a re-import over unchanged notes never writes back a drawing the user
 * deleted, renamed or moved away". A missing part between the first one and the last one left is
 * an edit; parts past the last one are a note that grew (written).
 */
import { describe, expect, test } from "vitest";

import { partsMissing } from "../src/reimport";

const P = (n: number, dir = "Vault") =>
  n === 1 ? `${dir}/Long.excalidraw` : `${dir}/Long (part ${n}).excalidraw`;

describe("partsMissing", () => {
  test.each([
    ["all parts there", [1, 2, 3], false],
    ["only the first part (the note may have grown)", [1], false],
    ["first part deleted or renamed", [2, 3], true],
    ["a middle part deleted", [1, 3], true],
    ["every part gone", [], true],
  ] as const)("%s", (_, have, missing) => {
    const existing = new Set<string>([
      ...have.map((n) => P(n)),
      "Vault/Renamed.excalidraw",
      "Vault/Long notes.excalidraw",
      "Other/Long (part 2).excalidraw",
    ]);
    expect(partsMissing(P(1), existing)).toBe(missing);
  });

  test("a part in another folder does not count", () => {
    expect(partsMissing(P(1), new Set([P(2, "Other"), P(3, "Other")]))).toBe(
      true,
    );
    expect(
      partsMissing(P(1), new Set([P(1), "Vault/sub/Long (part 2).excalidraw"])),
    ).toBe(false);
  });

  test("names with pattern characters", () => {
    const head = "Vault/A (b) [c].excalidraw";
    expect(
      partsMissing(
        head,
        new Set([head, "Vault/A (b) [c] (part 2).excalidraw"]),
      ),
    ).toBe(false);
    expect(
      partsMissing(head, new Set(["Vault/A (b) [c] (part 2).excalidraw"])),
    ).toBe(true);
  });

  test("a note at the vault root", () => {
    expect(
      partsMissing("Long.excalidraw", new Set(["Long (part 2).excalidraw"])),
    ).toBe(true);
    expect(partsMissing("Long.excalidraw", new Set(["Long.excalidraw"]))).toBe(
      false,
    );
  });
});
