import { describe, expect, it } from "vitest";

import { fontFamilyOf, readSettings } from "../src/settings";

import type { PluginContext } from "@vaultdraw/api";

const ctxWith = (values: Record<string, unknown>, drawing?: string) =>
  ({
    settings: { get: (k: string) => values[k] },
    scene: {
      currentTextStyle: () => {
        if (!drawing) {
          throw new Error("no drawing");
        }
        return { fontFamily: drawing, fontSize: 20 };
      },
    },
  } as unknown as PluginContext);

describe("import font", () => {
  it("'default' follows the user's drawing font", () => {
    const s = readSettings(ctxWith({}, "Nunito"));
    expect(s.font).toBe("default");
    expect(fontFamilyOf(s)).toBe("Nunito");
  });

  it("falls back to Excalifont when the host cannot say", () => {
    expect(fontFamilyOf(readSettings(ctxWith({})))).toBe("Excalifont");
  });

  it("'document' and named fonts ignore the drawing font", () => {
    expect(fontFamilyOf(readSettings(ctxWith({ font: "document" }, "Nunito")))).toBe(
      "Liberation Sans",
    );
    expect(
      fontFamilyOf(readSettings(ctxWith({ font: "comic-shanns" }, "Nunito"))),
    ).toBe("Comic Shanns");
  });

  it("an unknown value is the default", () => {
    expect(readSettings(ctxWith({ font: "papyrus" }, "Virgil")).font).toBe(
      "default",
    );
  });
});
