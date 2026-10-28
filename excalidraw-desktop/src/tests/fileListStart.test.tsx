/**
 * files.list_start: the webview's walk of every vault folder
 * (scanVaultMetadata) waits for its start mode. The tree's own root listing
 * happens at open in every mode.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VaultApp } from "../VaultApp";
import { updatePreferences } from "../vault/preferences";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE } from "./fixtures";

import type { StartMode } from "../services/servicesSettings";

const idle = vi.hoisted(() => ({ callbacks: [] as (() => void)[] }));
vi.mock("../services/whenIdle", () => ({
  whenIdle: (_win: Window, cb: () => void) => {
    idle.callbacks.push(cb);
    return () => {
      idle.callbacks = idle.callbacks.filter((c) => c !== cb);
    };
  },
}));

const tree = () => within(screen.getByLabelText("Vault file navigator"));

async function openWith(mode: StartMode) {
  await updatePreferences({ filesListStart: mode });
  const repo = new FakeVaultRepository();
  repo.seedDrawing("root.excalidraw", BLANK_SCENE);
  repo.seedDrawing("deep/inner.excalidraw", BLANK_SCENE);
  const listed = vi.spyOn(repo, "listDirectory");
  render(<VaultApp repository={repo} initialVault={repo.vault} />);
  await waitFor(() => expect(tree().getByText("root")).toBeInTheDocument());
  // Let the open settle (effects, the root listing, any eager walk).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  const walked = () => listed.mock.calls.some(([, path]) => path === "deep");
  return { walked };
}

describe("files.list_start", () => {
  beforeEach(() => {
    idle.callbacks = [];
  });
  afterEach(async () => {
    await updatePreferences({ filesListStart: "idle" });
  });

  it("idle: only the root is listed at open; the walk runs once idle", async () => {
    const { walked } = await openWith("idle");
    expect(walked()).toBe(false);

    act(() => {
      for (const cb of [...idle.callbacks]) {
        cb();
      }
    });
    await waitFor(() => expect(walked()).toBe(true));
  });

  it("open: the walk runs at vault open", async () => {
    const { walked } = await openWith("open");
    await waitFor(() => expect(walked()).toBe(true));
  });

  it("use: the home page's recent drawings count as a use and start it", async () => {
    const { walked } = await openWith("use");
    // No idle callback is needed: the home pane on screen asks for the list.
    await waitFor(() => expect(walked()).toBe(true));
    expect(
      await screen.findByRole("button", { name: /inner/ }),
    ).toBeInTheDocument();
  });
});
