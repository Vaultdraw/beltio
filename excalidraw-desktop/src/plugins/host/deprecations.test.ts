import { beforeEach, describe, expect, it } from "vitest";

import {
  getPluginLog,
  resetErrors,
  resetPluginErrors,
  warnDeprecated,
} from "./errors";

describe("warnDeprecated", () => {
  beforeEach(() => resetErrors());

  it("logs a deprecation once per plugin and name", () => {
    warnDeprecated("demo", "x", "x goes in 2.0");
    warnDeprecated("demo", "x", "x goes in 2.0");
    warnDeprecated("demo", "y", "y goes in 2.0");
    warnDeprecated("other", "x", "x goes in 2.0");
    expect(getPluginLog("demo").map((l) => l.text)).toEqual([
      "deprecated: x goes in 2.0",
      "deprecated: y goes in 2.0",
    ]);
    expect(getPluginLog("demo").every((l) => l.level === "warn")).toBe(true);
    expect(getPluginLog("other")).toHaveLength(1);
  });

  it("warns again after the plugin reloads", () => {
    warnDeprecated("demo", "x", "x goes in 2.0");
    resetPluginErrors("demo");
    warnDeprecated("demo", "x", "x goes in 2.0");
    expect(getPluginLog("demo")).toHaveLength(2);
  });
});
