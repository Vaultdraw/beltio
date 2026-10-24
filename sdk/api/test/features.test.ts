import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FEATURES_FILE,
  generate,
  readFeatures,
} from "../scripts/gen-features.mjs";
import { API_REVISION, FEATURES } from "../testing/features";

describe("testing/features.ts", () => {
  it("matches the @since tags of sdk/api/src", () => {
    const actual: string = generate();
    if (process.env.UPDATE_FEATURES === "1") {
      fs.writeFileSync(FEATURES_FILE, actual);
      return;
    }
    expect(
      actual === fs.readFileSync(FEATURES_FILE, "utf8"),
      "sdk/api/testing/features.ts is out of date. Run " +
        "`node sdk/api/scripts/gen-features.mjs` and commit it.",
    ).toBe(true);
  });

  it("takes the revision from package.json", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
    );
    expect(API_REVISION).toBe(pkg.version);
    expect(readFeatures().revision).toBe(pkg.version);
  });

  it("names ctx members, their members and app events", () => {
    for (const name of [
      "commands.register",
      "scene.batch",
      "drawing.saved",
      "host.has",
      "theme.tokens",
      "manifest.permissions",
    ]) {
      expect(FEATURES, name).toHaveProperty([name]);
    }
    expect(FEATURES["theme.tokens"]).toBe("0.2.0");
    expect(FEATURES["commands.register"]).toBe("0.1.0");
  });

  it("never lists a feature newer than the revision", () => {
    const [maj, min] = API_REVISION.split(".").map(Number);
    for (const [name, since] of Object.entries(FEATURES)) {
      const [a, b] = since.split(".").map(Number);
      expect(a < maj || (a === maj && b <= min), name).toBe(true);
    }
  });
});
