import { describe, expect, it } from "vitest";

import { isPluginVisiblePath } from "./workspaceBridge";

describe("isPluginVisiblePath", () => {
  it.each([
    ["a.excalidraw", true],
    ["notes/B.Excalidraw", true],
    ["notes", true],
    ["notes/secret.pdf", false],
    [".git/HEAD", false],
    ["a/.obsidian/x.excalidraw", false],
  ])("%s -> %s", (path, ok) => {
    expect(isPluginVisiblePath(path)).toBe(ok);
  });
});
