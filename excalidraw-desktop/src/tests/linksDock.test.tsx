import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installListKeysForTests,
  pressListKey,
} from "../commands/listKeysForTests";

import { LinksDock } from "../components/links/LinksDock";

import { FakeVaultLinks } from "./fakeVaultLinks";
import { FakeVaultRepository } from "./fakeVaultRepository";

import type { LinksResponse, VaultLinks } from "../links/types";

type El = Record<string, unknown>;
const text = (id: string, t: string): El => ({
  id,
  type: "text",
  text: t,
  originalText: t,
  version: 1,
});
const scene = (...elements: El[]) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements,
    appState: {},
    files: {},
  });

function setup() {
  const repo = new FakeVaultRepository();
  repo.seedDrawing(
    "Notes.excalidraw",
    scene(text("n", "outgoing [[Graphs/BFS]] and [[Ghost]]")),
  );
  repo.seedDrawing(
    "Graphs/BFS.excalidraw",
    scene(text("a", "see [[Notes]] here"), text("b", "no link")),
  );
  repo.seedDrawing(
    "Work/Plan.excalidraw",
    scene(
      text("p", "[[Notes|n]] again"),
      text("m", "I mention notes without a link"),
    ),
  );
  const links = new FakeVaultLinks(repo);
  const onOpen = vi.fn();
  const onCreate = vi.fn();
  const props = {
    links: links as VaultLinks,
    handle: repo.handle,
    path: "Notes.excalidraw",
    refreshKey: 0,
    onOpen,
    onCreate,
    visible: true,
  };
  return { repo, links, onOpen, onCreate, props };
}

let uninstall = () => {};
beforeEach(() => {
  uninstall = installListKeysForTests();
});
afterEach(() => {
  uninstall();
  cleanup();
});

const dock = () => screen.getByRole("region", { name: "Links" });
const key = (k: string, init: KeyboardEventInit = {}) =>
  pressListKey(dock(), k, init);
const selected = () => within(dock()).getByRole("option", { selected: true });

describe("LinksDock", () => {
  it("queries nothing while hidden or without a drawing, and renders nothing", async () => {
    const { links, props } = setup();
    const { container, rerender } = render(
      <LinksDock {...props} visible={false} />,
    );
    rerender(<LinksDock {...props} visible={false} refreshKey={1} />);
    rerender(<LinksDock {...props} path={null} visible />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(links.calls.links).toBe(0);
    rerender(<LinksDock {...props} visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows backlinks with snippets and counts, and Outgoing with unresolved", async () => {
    const { props } = setup();
    render(<LinksDock {...props} />);
    await screen.findByRole("tab", { name: "Backlinks (2)" });
    expect(
      screen.getByRole("tab", { name: "Outgoing (2)" }),
    ).toBeInTheDocument();
    const rows = within(dock()).getAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Linked mentions2",
      "BFSGraphssee [[Notes]] here",
      "PlanWork[[Notes|n]] again",
      "Unlinked mentions",
    ]);
    expect(dock().querySelector("mark")?.textContent).toBe("[[Notes]]");
    fireEvent.click(screen.getByRole("tab", { name: /Outgoing/ }));
    expect(
      within(dock())
        .getAllByRole("option")
        .map((r) => r.textContent),
    ).toEqual([
      "Links1",
      "Graphs/BFSGraphs/BFS",
      "Unresolved links1",
      "GhostCreate",
    ]);
  });

  it("keeps Unlinked mentions collapsed and computes them only when expanded", async () => {
    const { links, props, onOpen } = setup();
    render(<LinksDock {...props} />);
    await screen.findByRole("tab", { name: /Backlinks \(2\)/ });
    expect(links.calls.unlinkedMentions).toBe(0);
    key("G"); // last row: the Unlinked mentions header
    expect(selected()).toHaveTextContent("Unlinked mentions");
    key("l");
    await waitFor(() =>
      expect(dock().textContent).toContain("I mention notes without a link"),
    );
    expect(links.calls.unlinkedMentions).toBe(1);
    key("j");
    key("Enter");
    expect(onOpen).toHaveBeenCalledWith("Work/Plan.excalidraw", "m");
    key("h"); // collapse again, selection moves to the header
    expect(selected()).toHaveTextContent("Unlinked mentions");
    expect(dock().textContent).not.toContain("I mention notes without");
  });

  it("navigates with j/k and arrows, opens with Enter and o", async () => {
    const { props, onOpen } = setup();
    render(<LinksDock {...props} />);
    await screen.findByRole("tab", { name: /Backlinks \(2\)/ });
    expect(selected()).toHaveTextContent("Linked mentions");
    key("j");
    expect(selected()).toHaveTextContent("BFS");
    key("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("Graphs/BFS.excalidraw", "a");
    key("ArrowDown");
    key("o");
    expect(onOpen).toHaveBeenLastCalledWith("Work/Plan.excalidraw", "p");
    key("k");
    key("ArrowUp");
    expect(selected()).toHaveTextContent("Linked mentions");
    key("ArrowUp"); // stays at the top
    expect(selected()).toHaveTextContent("Linked mentions");
    key("j", { metaKey: true }); // modifiers are not ours
    expect(selected()).toHaveTextContent("Linked mentions");
  });

  it("Enter on a header toggles it; h and l collapse and expand the section", async () => {
    const { props } = setup();
    render(<LinksDock {...props} />);
    await screen.findByRole("tab", { name: /Backlinks \(2\)/ });
    key("Enter");
    expect(
      within(dock()).queryByText("see [[Notes]] here", { exact: false }),
    ).toBeNull();
    key("l");
    expect(within(dock()).getByText(/see/)).toBeInTheDocument();
    key("j");
    key("h");
    expect(selected()).toHaveTextContent("Linked mentions");
    expect(within(dock()).queryAllByRole("option")).toHaveLength(2);
  });

  it("Tab switches tabs; Enter opens a resolved link and creates an unresolved one", async () => {
    const { props, onOpen, onCreate } = setup();
    render(<LinksDock {...props} />);
    await screen.findByRole("tab", { name: /Backlinks \(2\)/ });
    key("Tab");
    expect(screen.getByRole("tab", { name: /Outgoing/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    key("j");
    key("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("Graphs/BFS.excalidraw");
    key("j");
    key("j");
    key("Enter");
    expect(onCreate).toHaveBeenCalledWith("Ghost");
    fireEvent.click(within(dock()).getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledTimes(2);
    key("Tab");
    expect(screen.getByRole("tab", { name: /Backlinks/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("refetches when the drawing changes and when refreshKey changes (debounced)", async () => {
    const { repo, links, props } = setup();
    const { rerender } = render(<LinksDock {...props} />);
    await screen.findByRole("tab", { name: /Backlinks \(2\)/ });
    expect(links.calls.links).toBe(1);
    rerender(<LinksDock {...props} path="Graphs/BFS.excalidraw" />);
    // the previous drawing's links are not shown while loading
    expect(
      screen.queryByRole("tab", { name: /Backlinks \(2\)/ }),
    ).not.toBeInTheDocument();
    await screen.findByRole("tab", { name: "Backlinks (1)" });
    repo.seedDrawing("Extra.excalidraw", scene(text("x", "[[BFS]]")));
    rerender(
      <LinksDock {...props} path="Graphs/BFS.excalidraw" refreshKey={1} />,
    );
    rerender(
      <LinksDock {...props} path="Graphs/BFS.excalidraw" refreshKey={2} />,
    );
    await screen.findByRole("tab", { name: "Backlinks (2)" });
    expect(links.calls.links).toBe(3); // two quick bumps -> one query
  });

  it("shows empty states and survives a failing query", async () => {
    const { props } = setup();
    const failing = {
      ...props.links,
      links: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as VaultLinks;
    const { rerender } = render(
      <LinksDock {...props} path="Work/Plan.excalidraw" />,
    );
    await screen.findByRole("tab", { name: /Backlinks \(0\)/ });
    expect(screen.getByText("No backlinks")).toBeInTheDocument();
    rerender(<LinksDock {...props} links={failing} path="Other.excalidraw" />);
    await screen.findByText("Something went wrong.");
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("refreshes within the frame budget (200 rows, no IPC cost)", async () => {
    const big: LinksResponse = {
      path: "x",
      outgoing: [],
      unresolved: [],
      tookMs: 0,
      backlinks: Array.from({ length: 200 }, (_, i) => ({
        path: `Folder ${i % 7}/Drawing ${i}.excalidraw`,
        elementId: `e${i}`,
        containerId: null,
        kind: "text" as const,
        snippet: `some text before [[Target]] and after ${i}`,
        highlights: [[17, 27]] as [number, number][],
      })),
    };
    const stub: VaultLinks = {
      links: async (_h: string, path: string) => ({ ...big, path }),
    } as unknown as VaultLinks;
    const base = {
      links: stub,
      handle: "h",
      refreshKey: 0,
      onOpen() {},
      onCreate() {},
      visible: true,
    };
    const { rerender } = render(<LinksDock {...base} path="p0" />);
    await waitFor(() =>
      expect(dock().querySelectorAll("mark")).toHaveLength(200),
    );
    const times: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const t0 = performance.now();
      rerender(<LinksDock {...base} path={`p${i}`} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0)); // the 0 ms fetch timer
        await Promise.resolve();
      });
      times.push(performance.now() - t0);
      expect(dock().querySelectorAll("mark")).toHaveLength(200);
    }
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.floor(q * (times.length - 1))];
    // eslint-disable-next-line no-console
    console.info(
      `links dock refresh (200 rows, jsdom, incl. 0 ms timer): p50 ${p(
        0.5,
      ).toFixed(1)} ms, p95 ${p(0.95).toFixed(1)} ms`,
    );
    // Deterministic here: every refresh fetched once and rendered all rows
    // (asserted in the loop). The wall-clock frame budget lives in the
    // E2E_PERF spec (e2e/linksPerf.spec.ts); a loaded CI machine must not
    // fail this suite, so the timing bound only applies with PERF_STRICT=1.
    if (process.env.PERF_STRICT === "1") {
      expect(p(0.95)).toBeLessThan(60);
    }
  });
});
