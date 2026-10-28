/** Tags panel, tree chips and the chips setting, in VaultApp over the fakes. */
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
import { setNavigatorCollapsed, updatePreferences } from "../vault/preferences";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { FakeVaultSearch } from "./fakeVaultSearch";
import { SAMPLE_SCENE, SEARCH_SCENE } from "./fixtures";

vi.mock("../editor/VaultEditor", () => ({
  default: () => <div className="vault-editor" data-testid="editor" />,
}));

const withText = (text: string) =>
  SEARCH_SCENE.split("Dijkstra shortest path").join(text);

const input = () => screen.getByPlaceholderText(/Search drawings/i);
const nav = () => within(screen.getByLabelText("Vault file navigator"));

function setup(tagged: Record<string, string> = {}) {
  const repo = new FakeVaultRepository();
  repo.seedDrawing("Plain.excalidraw", SAMPLE_SCENE);
  for (const [path, text] of Object.entries(tagged)) {
    repo.seedDrawing(path, withText(text));
  }
  render(
    <VaultApp
      repository={repo}
      search={new FakeVaultSearch(repo)}
      initialVault={repo.vault}
    />,
  );
  return repo;
}

const TAGGED = {
  "A.excalidraw": "notes #dsa/graphs #dsa/trees #misc",
  "B.excalidraw": "more #dsa/graphs",
};

beforeEach(() => {
  setNavigatorCollapsed(false, window);
  updatePreferences({ showTagChips: true }, window);
});
afterEach(() => cleanup());

describe("TagsPanel", () => {
  it("is hidden when the vault has no tags", async () => {
    setup();
    await nav().findByText("Plain");
    expect(screen.queryByRole("region", { name: "Tags" })).toBeNull();
  });

  it("lists nested tags with counts and collapses parents", async () => {
    setup(TAGGED);
    const panel = within(await screen.findByRole("region", { name: "Tags" }));
    expect(
      panel.getByRole("button", { name: "Tag dsa, 2 drawings" }),
    ).toBeTruthy();
    expect(
      panel.getByRole("button", { name: "Tag dsa/graphs, 2 drawings" }),
    ).toBeTruthy();
    expect(
      panel.getByRole("button", { name: "Tag misc, 1 drawing" }),
    ).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Collapse dsa" }));
    expect(panel.queryByRole("button", { name: /Tag dsa\/graphs/ })).toBeNull();
    expect(panel.getByRole("button", { name: "Expand dsa" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("filters on click, highlights the active tag and clears on second click", async () => {
    setup(TAGGED);
    const panel = within(await screen.findByRole("region", { name: "Tags" }));
    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: /^Tag misc/ }));
    });
    expect(input()).toHaveValue("tag:#misc");
    // A plain tag filter keeps the panel; results show the tagged drawing only.
    const rows = (await screen.findAllByRole("option")).filter(
      (r) => r.getAttribute("data-kind") === "drawing",
    );
    expect(rows.map((r) => r.getAttribute("data-path"))).toEqual([
      "A.excalidraw",
    ]);
    const active = within(screen.getByRole("region", { name: "Tags" }));
    const misc = active.getByRole("button", { name: /^Tag misc/ });
    expect(misc).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(misc);
    });
    expect(input()).toHaveValue("");
    expect(
      within(screen.getByRole("region", { name: "Tags" })).getByRole("button", {
        name: /^Tag misc/,
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("hides the panel during a free-text search", async () => {
    setup(TAGGED);
    await screen.findByRole("region", { name: "Tags" });
    await act(async () => {
      fireEvent.change(input(), { target: { value: "tag:#misc plain" } });
    });
    expect(screen.queryByRole("region", { name: "Tags" })).toBeNull();
  });

  it("toggles the whole section", async () => {
    setup(TAGGED);
    const panel = within(await screen.findByRole("region", { name: "Tags" }));
    const header = panel.getByRole("button", { name: "Tags" });
    fireEvent.click(header);
    expect(panel.queryByRole("button", { name: /^Tag misc/ })).toBeNull();
    fireEvent.click(header);
    expect(panel.getByRole("button", { name: /^Tag misc/ })).toBeTruthy();
  });
});

describe("tag chips", () => {
  it("shows two chips plus +N with the full list in the title", async () => {
    setup(TAGGED);
    const a = (await nav().findByText("A")).closest(".vault-tree-item")!;
    await waitFor(() =>
      expect(a.querySelectorAll(".vault-tag-chip")).toHaveLength(2),
    );
    expect(a.querySelector(".vault-tag-chips__more")?.textContent).toBe("+1");
    expect(a.querySelector(".vault-tag-chips")).toHaveAttribute(
      "title",
      "#dsa/graphs, #dsa/trees, #misc",
    );
    const b = nav().getByText("B").closest(".vault-tree-item")!;
    expect(b.querySelector(".vault-tag-chips__more")).toBeNull();
    const plain = nav().getByText("Plain").closest(".vault-tree-item")!;
    expect(plain.querySelector(".vault-tag-chip")).toBeNull();
  });

  it("clicking a chip filters without opening the drawing", async () => {
    setup(TAGGED);
    const b = (await nav().findByText("B")).closest(".vault-tree-item")!;
    const chip = await within(b as HTMLElement).findByRole("button", {
      name: "Filter by tag dsa/graphs",
    });
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(input()).toHaveValue("tag:#dsa/graphs");
    expect(screen.queryByTestId("editor")).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("option")
          .filter((r) => r.getAttribute("data-kind") === "drawing"),
      ).toHaveLength(2),
    );
  });

  it("hides chips when the setting is off", async () => {
    updatePreferences({ showTagChips: false }, window);
    setup(TAGGED);
    await screen.findByRole("region", { name: "Tags" });
    expect(document.querySelector(".vault-tag-chip")).toBeNull();
  });
});
