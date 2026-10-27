// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";

import { OFFICIAL_PLUGINS } from "../plugins/officialPlugins";
import { officialCommandDefs } from "../plugins/boot";

import { BUILTIN_COMMANDS } from "./commands";

import { findConflicts, whenCanOverlap } from "./conflicts";
import { readContext } from "./context";
import { installListKeysForTests } from "./listKeysForTests";
import { useViewCommands, type ViewActions } from "./useViewCommands";
// The graph's in-view command ids (the plugin's: plugins/official/graph/src/commandIds.ts).
const V = {
  left: "graph.moveLeft",
  right: "graph.moveRight",
  up: "graph.moveUp",
  down: "graph.moveDown",
  close: "graph.close",
} as const;
const GRAPH_VIEW_IDS: readonly string[] = [...Object.values(V), "graph.fit"];

const APP = { vaultOpen: true, drawingOpen: true, writable: true };

function View({
  scope,
  ids,
  actions,
}: {
  scope: string;
  ids: readonly string[];
  actions: ViewActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useViewCommands(ref, ids, actions);
  return (
    <div ref={ref} tabIndex={0} data-keyscope={scope} data-testid="view">
      <input data-testid="field" />
    </div>
  );
}

const GRAPH_DEFS = officialCommandDefs(
  OFFICIAL_PLUGINS.find((p) => p.id === "graph")!,
);

let uninstall: () => void;
beforeEach(() => {
  uninstall = installListKeysForTests("mac", window, GRAPH_DEFS);
});
afterEach(() => uninstall());

describe("view scopes", () => {
  it("galleryFocus / graphFocus hold in their view, not in its fields", () => {
    const { getByTestId } = render(
      <View scope="graph" ids={[]} actions={{}} />,
    );
    getByTestId("view").focus();
    const ctx = readContext(document, APP);
    expect(ctx.graphFocus).toBe(true);
    expect(ctx.galleryFocus).toBe(false);
    expect(ctx.listFocus).toBe(false);
    getByTestId("field").focus();
    expect(readContext(document, APP).graphFocus).toBe(false);
  });

  it("different focus scopes never conflict, so shared letters are not flagged", () => {
    expect(whenCanOverlap(["galleryFocus"], ["listFocus"])).toBe(false);
    expect(whenCanOverlap(["graphFocus"], ["galleryFocus"])).toBe(false);
    expect(whenCanOverlap(["graphFocus"], ["graphFocus"])).toBe(true);
    const conflicts = findConflicts(
      [...BUILTIN_COMMANDS, ...GRAPH_DEFS],
      {},
      "mac",
    );
    expect(conflicts.get("graph.moveDown")?.get("J")).toBeUndefined();
  });
});

describe("useViewCommands through the dispatcher", () => {
  it("runs a bound action with the default key, only with focus in the view", () => {
    const close = vi.fn();
    const { getByTestId } = render(
      <View
        scope="graph"
        ids={GRAPH_VIEW_IDS}
        actions={{ [V.close]: close }}
      />,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    getByTestId("view").focus();
    fireEvent.keyDown(getByTestId("view"), { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("an action that is missing now is not offered: its key passes through", () => {
    const { getByTestId, rerender } = render(
      <View
        scope="graph"
        ids={GRAPH_VIEW_IDS}
        actions={{ [V.close]: vi.fn() }}
      />,
    );
    getByTestId("view").focus();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    rerender(<View scope="graph" ids={GRAPH_VIEW_IDS} actions={{}} />);
    fireEvent.keyDown(getByTestId("view"), { key: "Escape" });
    document.removeEventListener("keydown", seen);
    expect(seen).toHaveBeenCalledTimes(1); // not swallowed by the dispatcher
  });

  it("plain letters in the view's text field are left alone", () => {
    const down = vi.fn();
    const { getByTestId } = render(
      <View scope="graph" ids={GRAPH_VIEW_IDS} actions={{ [V.down]: down }} />,
    );
    getByTestId("field").focus();
    fireEvent.keyDown(getByTestId("field"), { key: "j" });
    expect(down).not.toHaveBeenCalled();
  });

  it("every graph default key is a plain chord with a focus scope", () => {
    for (const id of GRAPH_VIEW_IDS) {
      const c = GRAPH_DEFS.find((x) => x.id === id)!;
      expect(c.when).toContain("graphFocus");
    }
  });
});
