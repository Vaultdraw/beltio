import { describe, expect, it } from "vitest";

import { SHARED_MODULES } from "../../../excalidraw-desktop/src/plugins/shared/specifiers";
import { SHARED_SPECIFIERS } from "../src/index";

describe("SHARED_SPECIFIERS", () => {
  it("equals the app's SHARED_MODULES specifiers, same order", () => {
    expect([...SHARED_SPECIFIERS]).toEqual(
      SHARED_MODULES.map((m) => m.specifier),
    );
  });
});
