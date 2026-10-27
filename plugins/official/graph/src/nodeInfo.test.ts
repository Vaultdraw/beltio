import { describe, expect, it } from "vitest";

import { fakeGraph } from "./fakeGraph";
import { describeNode, displayName } from "./nodeInfo";
import { FLAG_TAG } from "./types";

describe("displayName", () => {
  const g = fakeGraph(300);

  it("drops the folders of drawings and ghosts, keeps tags whole", () => {
    let sawFolder = false;
    for (let i = 0; i < g.nodeCount; i++) {
      const label = g.label(i);
      const name = displayName(g, i);
      if (g.flags[i] & FLAG_TAG) {
        expect(name).toBe(label);
        continue;
      }
      expect(name).not.toContain("/");
      expect(label.endsWith(name)).toBe(true);
      sawFolder ||= label.includes("/");
    }
    expect(sawFolder).toBe(true);
  });

  it("is what the hover card shows as the name", () => {
    for (let i = 0; i < 20; i++) {
      expect(describeNode(g, i).name).toBe(displayName(g, i));
    }
  });
});
