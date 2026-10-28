import { expect, type Page } from "@playwright/test";
import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family: a change made outside the app (file manager, sync, git) shows up in the tree.
// Members: create / delete / rename / move x file / folder x root / nested x drawing / note,
// a folder with children, a burst of many changes, a deleted drawing with its tab open.
// Real file-system events are covered by the Rust watcher table (vault_watch.rs); here the
// in-memory vault changes behind the app's back and reports what the native watcher would.
// The last test is the visible-UI one: Refresh button after a change nobody reported.

type Change = {
  op: "create" | "mkdir" | "delete" | "rename";
  path: string;
  to?: string;
  quiet?: boolean;
};

const outside = (page: Page, change: Change) =>
  page.evaluate((c) => (window as any).__vaultRepo.outside(c), change);
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const CASES: Array<{
  name: string;
  change: Change;
  gone?: string[];
  here?: string[];
}> = [
  {
    name: "create a drawing at the root",
    change: { op: "create", path: "Root.excalidraw" },
    here: ["Root.excalidraw"],
  },
  {
    name: "create a note at the root",
    change: { op: "create", path: "Fresh.md" },
    here: ["Fresh.md"],
  },
  {
    name: "create a folder at the root",
    change: { op: "mkdir", path: "Made" },
    here: ["Made"],
  },
  {
    name: "create a drawing in an open folder",
    change: { op: "create", path: "DSA/New.excalidraw" },
    here: ["DSA/New.excalidraw"],
  },
  {
    name: "create a nested folder",
    change: { op: "mkdir", path: "DSA/Dynamic Programming/Deep" },
    here: ["DSA/Dynamic Programming/Deep"],
  },
  {
    name: "rename a drawing",
    change: {
      op: "rename",
      path: "DSA/Graphs.excalidraw",
      to: "DSA/Graphs2.excalidraw",
    },
    gone: ["DSA/Graphs.excalidraw"],
    here: ["DSA/Graphs2.excalidraw"],
  },
  {
    name: "rename a note",
    change: { op: "rename", path: "Fresh.md", to: "Fresher.md" },
    gone: ["Fresh.md"],
    here: ["Fresher.md"],
  },
  {
    name: "move a drawing into a folder",
    change: {
      op: "rename",
      path: "Root.excalidraw",
      to: "DSA/Root.excalidraw",
    },
    gone: ["Root.excalidraw"],
    here: ["DSA/Root.excalidraw"],
  },
  {
    name: "rename a folder with children",
    change: { op: "rename", path: "DSA/Dynamic Programming", to: "DSA/DP" },
    gone: [
      "DSA/Dynamic Programming",
      "DSA/Dynamic Programming/01 Introduction.excalidraw",
    ],
    here: ["DSA/DP"],
  },
  {
    name: "delete a drawing",
    change: { op: "delete", path: "DSA/New.excalidraw" },
    gone: ["DSA/New.excalidraw"],
  },
  {
    name: "delete a note",
    change: { op: "delete", path: "Fresher.md" },
    gone: ["Fresher.md"],
  },
  {
    name: "delete an empty folder",
    change: { op: "delete", path: "Made" },
    gone: ["Made"],
  },
  {
    name: "delete a nested folder with children",
    change: { op: "delete", path: "DSA/DP" },
    gone: ["DSA/DP", "DSA/DP/01 Introduction.excalidraw"],
  },
  {
    name: "delete an open folder's parent",
    change: { op: "delete", path: "DSA" },
    gone: ["DSA", "DSA/Graphs2.excalidraw"],
  },
];

test("outside changes show up: every kind of create, rename, move and delete", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=obsidian");
  await row(page, "DSA").click();
  await row(page, "DSA/Dynamic Programming").click();
  await expect(
    row(page, "DSA/Dynamic Programming/01 Introduction.excalidraw"),
  ).toBeVisible();
  for (const c of CASES) {
    if (c.name === "delete a drawing") {
      // The renamed folder lists its children once opened.
      await row(page, "DSA/DP").click();
      await expect(
        row(page, "DSA/DP/01 Introduction.excalidraw"),
      ).toBeVisible();
    }
    await outside(page, c.change);
    for (const p of c.here ?? []) {
      await expect(row(page, p), `${c.name}: ${p} appears`).toBeVisible();
    }
    for (const p of c.gone ?? []) {
      await expect(row(page, p), `${c.name}: ${p} disappears`).toHaveCount(0);
    }
  }
  expect(errors).toEqual([]);
});

test("a burst of outside changes settles on the right tree", async ({
  page,
}) => {
  await openVault(page);
  const names = Array.from({ length: 40 }, (_, i) => `Burst/n${i}.excalidraw`);
  await page.evaluate((ns) => {
    const repo = (window as any).__vaultRepo;
    for (const p of ns) {
      repo.outside({ op: "create", path: p });
    }
    for (const p of ns.filter((_, i) => i % 2 === 0)) {
      repo.outside({ op: "delete", path: p });
    }
  }, names);
  await expect(row(page, "Burst")).toBeVisible();
  await row(page, "Burst").click();
  await expect(row(page, "Burst/n1.excalidraw")).toBeVisible();
  await expect(row(page, "Burst/n39.excalidraw")).toBeVisible();
  await expect(row(page, "Burst/n0.excalidraw")).toHaveCount(0);
  await expect(row(page, "Burst/n38.excalidraw")).toHaveCount(0);
});

test("a drawing deleted outside while its tab is in the background marks the tab missing", async ({
  page,
}) => {
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, "DSA/Graphs.excalidraw").click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Graphs",
  );
  await row(page, "DSA/Dynamic Programming").click();
  await row(page, "DSA/Dynamic Programming/01 Introduction.excalidraw").click({
    modifiers: ["Meta"],
  });
  await expect(page.getByTestId("vault-tab")).toHaveCount(2);
  await outside(page, { op: "delete", path: "DSA/Graphs.excalidraw" });
  await expect(row(page, "DSA/Graphs.excalidraw")).toHaveCount(0);
  await expect(page.locator(".vault-tabs__tab--missing")).toHaveCount(1);
});

test("the Refresh button shows a change nobody reported", async ({ page }) => {
  await openVault(page);
  await row(page, "DSA").click();
  await outside(page, {
    op: "delete",
    path: "DSA/Graphs.excalidraw",
    quiet: true,
  });
  await outside(page, {
    op: "create",
    path: "DSA/Silent.excalidraw",
    quiet: true,
  });
  await expect(row(page, "DSA/Graphs.excalidraw")).toBeVisible();
  await page.getByRole("button", { name: "Refresh files" }).click();
  await expect(row(page, "DSA/Silent.excalidraw")).toBeVisible();
  await expect(row(page, "DSA/Graphs.excalidraw")).toHaveCount(0);
});
