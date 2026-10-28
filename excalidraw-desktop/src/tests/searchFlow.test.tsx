/** Vault search end to end in VaultApp: FakeVaultRepository + FakeVaultSearch. */
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

import { VaultApp } from "../VaultApp";
import { setNavigatorCollapsed } from "../vault/preferences";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { FakeVaultSearch } from "./fakeVaultSearch";
import { SAMPLE_SCENE, SEARCH_SCENE } from "./fixtures";

type EditorProps = {
  documentId: string;
  focusRequest: {
    path: string;
    elementId: string;
    containerId: string | null;
    nonce: number;
  } | null;
};
const editorProps: EditorProps[] = [];

vi.mock("../editor/VaultEditor", () => ({
  default: (props: EditorProps) => {
    editorProps.push(props);
    return <div className="vault-editor" data-testid="editor" />;
  },
}));

const navTree = () => within(screen.getByLabelText("Vault file navigator"));
const input = () => screen.getByPlaceholderText(/Search drawings/i);

/** The command registry binds Mod (Cmd on macOS, Ctrl elsewhere): pick one. */
const spoofPlatform = (platform: "Win32" | "MacIntel") => {
  const ua = platform === "Win32" ? "Windows" : "Macintosh";
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
};

function setup() {
  const repo = new FakeVaultRepository();
  repo.seedDrawing("DSA/Shortest Paths.excalidraw", SEARCH_SCENE);
  repo.seedDrawing("DSA/Graphs.excalidraw", SAMPLE_SCENE);
  const search = new FakeVaultSearch(repo);
  render(
    <VaultApp repository={repo} search={search} initialVault={repo.vault} />,
  );
  return { repo, search };
}

const type = (value: string) =>
  act(async () => {
    fireEvent.change(input(), { target: { value } });
  });

beforeEach(() => {
  editorProps.length = 0;
  setNavigatorCollapsed(false, window);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("vault search flow", () => {
  it("shows grouped results with highlighted snippets while typing", async () => {
    setup();
    await type("dijk");
    const rows = await screen.findAllByRole("option");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual([
      "drawing",
      "snippet",
    ]);
    expect(rows[0]).toHaveAttribute(
      "data-path",
      "DSA/Shortest Paths.excalidraw",
    );
    expect(rows[1]).toHaveTextContent("Dijkstra shortest path");
    const marks = [...document.querySelectorAll("mark.vault-search-mark")].map(
      (m) => m.textContent,
    );
    expect(marks).toEqual(["Dijk"]);
    await screen.findByText("1 drawing");
  });

  it("updates results per keystroke and clears on an empty query", async () => {
    setup();
    await type("d");
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThan(0),
    );
    await type("dijkstra zzzz");
    await screen.findByText("No matches");
    await type("");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("matches frames, accents and every term across elements", async () => {
    setup();
    await type("GRAPH ALG");
    const rows = await screen.findAllByRole("option");
    expect(rows.some((r) => r.textContent?.includes("Graph algorithms"))).toBe(
      true,
    );
    await type("dijkstra graph");
    await waitFor(() =>
      expect(screen.getAllByRole("option")[0]).toHaveAttribute(
        "data-path",
        "DSA/Shortest Paths.excalidraw",
      ),
    );
  });

  it("clicking a snippet opens the drawing and passes a focus request for the container", async () => {
    setup();
    await type("dijk");
    const snippet = (await screen.findAllByRole("option")).find(
      (r) => r.getAttribute("data-kind") === "snippet",
    )!;
    await act(async () => {
      fireEvent.click(snippet);
    });
    await waitFor(() =>
      expect(screen.getByTestId("editor")).toBeInTheDocument(),
    );
    await waitFor(() => {
      const last = editorProps.at(-1)!;
      expect(last.focusRequest).toMatchObject({
        path: "DSA/Shortest Paths.excalidraw",
        elementId: "algo-label",
        containerId: "algo-rect",
      });
    });
    const nonce = editorProps.at(-1)!.focusRequest!.nonce;
    expect(nonce).toBeGreaterThan(0);
  });

  it("clicking the drawing row opens it without a focus request", async () => {
    setup();
    await type("dijk");
    const row = (await screen.findAllByRole("option")).find(
      (r) => r.getAttribute("data-kind") === "drawing",
    )!;
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() =>
      expect(screen.getByTestId("editor")).toBeInTheDocument(),
    );
    expect(editorProps.at(-1)!.focusRequest).toBeNull();
  });

  it("opening the same match twice issues a new nonce (re-focus)", async () => {
    setup();
    for (let i = 0; i < 2; i++) {
      await type("dijk");
      const snippet = (await screen.findAllByRole("option")).find(
        (r) => r.getAttribute("data-kind") === "snippet",
      )!;
      await act(async () => {
        fireEvent.click(snippet);
      });
      await waitFor(() =>
        expect(editorProps.at(-1)?.focusRequest).not.toBeNull(),
      );
    }
    const nonces = new Set(
      editorProps.map((p) => p.focusRequest?.nonce).filter(Boolean),
    );
    expect(nonces.size).toBeGreaterThanOrEqual(2);
  });

  it("keyboard: ArrowDown to the snippet then Enter opens with a focus request", async () => {
    setup();
    await type("dijk");
    await screen.findAllByRole("option");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(editorProps.at(-1)?.focusRequest?.elementId).toBe("algo-label"),
    );
  });

  it("shows 'Indexing x of y' while the index is building and refreshes when ready", async () => {
    const { repo, search } = setup();
    search.setIndexState({ state: "building", indexed: 1 }, repo.vault.handle);
    await type("zzzz");
    await screen.findByText("Indexing 1 of 2 drawings…");
    await act(async () => {
      search.setIndexState(null, repo.vault.handle);
    });
    await waitFor(() => expect(screen.queryByText(/Indexing/)).toBeNull(), {
      timeout: 3000,
    });
    await screen.findByText("No matches");
  });

  it("indexing status line is appended to the result count", async () => {
    const { repo, search } = setup();
    search.setIndexState({ state: "building", indexed: 1 }, repo.vault.handle);
    await type("dijk");
    await screen.findByText(/1 drawing · Indexing 1 of 2 drawings…/);
  });

  it("Cmd+Shift+F focuses the search input", async () => {
    setup();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).not.toBe(input());
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: "F",
        code: "KeyF",
        metaKey: true,
        shiftKey: true,
      });
    });
    expect(document.activeElement).toBe(input());
  });

  it("Ctrl+Shift+F also works and selects existing text", async () => {
    spoofPlatform("Win32");
    setup();
    await type("dijk");
    (input() as HTMLInputElement).blur();
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: "F",
        code: "KeyF",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    const el = input() as HTMLInputElement;
    expect(document.activeElement).toBe(el);
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4]);
  });

  it("Cmd+Shift+F expands a collapsed navigator and focuses the input", async () => {
    setNavigatorCollapsed(true, window);
    setup();
    const aside = screen.getByLabelText("Vault file navigator", {
      selector: "aside",
    });
    expect(aside).toHaveAttribute("aria-hidden", "true");
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: "F",
        code: "KeyF",
        metaKey: true,
        shiftKey: true,
      });
    });
    await waitFor(() => expect(aside).toHaveAttribute("aria-hidden", "false"));
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(
      window.localStorage.getItem("excalidraw-vault:preferences") ?? "",
    ).not.toMatch(/"navigatorCollapsed":true/);
  });

  it("plain Cmd+F and Cmd+Shift+G do not steal focus", async () => {
    setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: "f",
        code: "KeyF",
        metaKey: true,
      });
      fireEvent.keyDown(document.body, {
        key: "G",
        code: "KeyG",
        metaKey: true,
        shiftKey: true,
      });
    });
    expect(document.activeElement).not.toBe(input());
  });

  it("clearing the query restores the file tree", async () => {
    setup();
    await type("dijk");
    await screen.findAllByRole("option");
    await type("");
    await waitFor(() => expect(navTree().getByText("DSA")).toBeInTheDocument());
  });
});
