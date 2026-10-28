import { describe, expect, it } from "vitest";

import { importDrawingLook } from "./newDrawingPaper";
import { DEFAULT_PREFERENCES } from "./preferences";

describe("importDrawingLook", () => {
  it("follows the theme (Match) when the default page mode is Normal", () => {
    const look = importDrawingLook(
      DEFAULT_PREFERENCES,
      DEFAULT_PREFERENCES.paperStyle,
    );
    expect(look.paperTheme).toBe("match");
    expect(look.viewBackgroundColor).toBe("#ffffff"); // the theme's colour transform draws it
  });

  it("takes the paper theme of the default page setup when that is Page mode", () => {
    const look = importDrawingLook(
      {
        ...DEFAULT_PREFERENCES,
        pageMode: "page",
        pagePaperTheme: "old_school",
      },
      DEFAULT_PREFERENCES.paperStyle,
    );
    expect(look.paperTheme).toBe("oldSchool");
    expect(look.viewBackgroundColor).toBe("#f8efd4");
  });
});
