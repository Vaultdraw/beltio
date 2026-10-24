/** Command audit (S8): the metadata rows added for click-only actions. */
import { describe, expect, it } from "vitest";

import { getCommand } from "./commands";
import { GRAPH_VIEW_IDS } from "./graphCommands";

const cases: [string, string, string][] = [
  ["history.backToCurrent", "History: Back to current version", "History"],
  ["history.dismissGitNotice", "History: Dismiss the git notice", "History"],
  ["graph.toggleArrows", "Graph: Toggle arrows", "Graph"],
  ["graph.toggleColourBy", "Graph: Toggle colour by folder or mono", "Graph"],
  ["graph.toggleSettings", "Graph: Toggle settings panel", "Graph"],
  ["graph.resetDisplay", "Graph: Reset display and forces", "Graph"],
  ["tags.toggleSection", "Tags: Collapse or expand the tags section", "Tags"],
  [
    "templates.revealGlobal",
    "Templates: Open the global templates folder",
    "Templates",
  ],
  ["page.dismissNotice", "Page: Dismiss the page notice", "Page"],
];

describe("command audit (S8) metadata", () => {
  it.each(cases)(
    "%s is registered with its title and category",
    (id, title, category) => {
      const def = getCommand(id);
      expect(def?.title).toBe(title);
      expect(def?.category).toBe(category);
      expect(def?.keys.default).toEqual([]);
      expect(def?.when?.length).toBeGreaterThan(0);
    },
  );

  it("the graph view commands are offered by the graph view while it is open", () => {
    for (const id of [
      "graph.toggleArrows",
      "graph.toggleColourBy",
      "graph.toggleSettings",
      "graph.resetDisplay",
    ]) {
      expect(GRAPH_VIEW_IDS).toContain(id);
      expect(getCommand(id)?.when).toContain("graphFocus");
    }
  });
});
