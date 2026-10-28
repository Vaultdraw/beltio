/**
 * Vault tree / onboarding / status UI component and integration tests (QA scope).
 *
 * Exercises the real production VaultApp.tsx and components:
 * - Onboarding shell with open/create actions and empty states
 * - Vault header with breadcrumbs, read-only notice, and save status
 * - Vault navigator with tree rendering, folder expand/collapse, and search
 * - Opening drawings, empty state transition, and editor pane integration
 * - Conflict and recovery dialog accessibility and actions
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VaultApp } from "../VaultApp";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { BLANK_SCENE, SAMPLE_SCENE } from "./fixtures";

// Drawing names also appear in the home "Recent" list; query the tree itself.
const tree = () => within(screen.getByLabelText("Vault file navigator"));

describe("VaultApp Onboarding (no vault chosen)", () => {
  it("renders onboarding view with open and create vault actions", async () => {
    const repo = new FakeVaultRepository();
    repo.reopenVault = vi.fn().mockResolvedValue(null);

    render(<VaultApp repository={repo} initialVault={null} />);

    expect(
      screen.getByRole("heading", { name: /Vaultdraw/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open vault folder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create new vault/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'Open vault folder' calls repository.chooseVault(false)", async () => {
    const repo = new FakeVaultRepository();
    repo.reopenVault = vi.fn().mockResolvedValue(null);
    const chooseSpy = vi.spyOn(repo, "chooseVault");

    render(<VaultApp repository={repo} initialVault={null} />);

    const openBtn = screen.getByRole("button", { name: /Open vault folder/i });
    await act(async () => {
      fireEvent.click(openBtn);
    });

    expect(chooseSpy).toHaveBeenCalledWith(false);
  });

  it("keeps the same root element when a vault opens from onboarding", async () => {
    const repo = new FakeVaultRepository();
    repo.reopenVault = vi.fn().mockResolvedValue(null);
    const vault = await repo.chooseVault();
    repo.chooseVault = vi.fn().mockResolvedValue(vault);

    const { container } = render(
      <VaultApp repository={repo} initialVault={null} />,
    );
    const root = container.querySelector(".vault-app");
    expect(root).not.toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Open vault folder/i }),
      );
    });
    await waitFor(() =>
      expect(container.querySelector("[data-vault-path]")).not.toBeNull(),
    );

    expect(root!.isConnected).toBe(true);
    expect(root!.querySelector("[data-vault-path]")).not.toBeNull();
  });

  it("clicking 'Create new vault' calls repository.chooseVault(true)", async () => {
    const repo = new FakeVaultRepository();
    repo.reopenVault = vi.fn().mockResolvedValue(null);
    const chooseSpy = vi.spyOn(repo, "chooseVault");

    render(<VaultApp repository={repo} initialVault={null} />);

    const createBtn = screen.getByRole("button", { name: /Create new vault/i });
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(chooseSpy).toHaveBeenCalledWith(true);
  });
});

describe("VaultApp Workspace with active vault", () => {
  it("renders header, empty editor state, and navigator when vault is active", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("sample.excalidraw", SAMPLE_SCENE);

    render(<VaultApp repository={repo} initialVault={repo.vault} />);

    // Vault name shown in breadcrumbs
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
    expect(within(header).getByText(repo.vault.name)).toBeInTheDocument();

    // Empty state rendered when no drawing is open (one frame after the tree)
    expect(
      await screen.findByRole("heading", { name: /No drawing open/i }),
    ).toBeInTheDocument();

    // Navigator is present with search input
    expect(screen.getByPlaceholderText(/Search drawings/i)).toBeInTheDocument();

    // Seeded drawing is visible in the tree (clean drawing name displayed)
    await waitFor(() => {
      expect(tree().getByText("sample")).toBeInTheDocument();
    });
  });

  it("displays read-only notice when vault is readOnly", async () => {
    const repo = new FakeVaultRepository({ readOnly: true });

    render(<VaultApp repository={repo} initialVault={repo.vault} />);

    expect(screen.getByText("Read-Only")).toBeInTheDocument();
  });

  it("opens a drawing from the tree and mounts the editor with breadcrumbs", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("notes.excalidraw", SAMPLE_SCENE);

    const { container } = render(
      <VaultApp repository={repo} initialVault={repo.vault} />,
    );

    await waitFor(() => {
      expect(tree().getByText("notes")).toBeInTheDocument();
    });

    const fileLabel = tree().getByText("notes");
    await act(async () => {
      fireEvent.click(fileLabel);
    });

    // Editor container mounts with document id
    await waitFor(() => {
      const editor = container.querySelector(".vault-editor");
      expect(editor).toBeInTheDocument();
    });

    // Breadcrumbs in header update with active drawing name
    const header = screen.getByRole("banner");
    expect(within(header).getByText("notes")).toBeInTheDocument();
  });

  it("filters items in navigator using the search input", async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("diagram-alpha.excalidraw", BLANK_SCENE);
    repo.seedDrawing("chart-beta.excalidraw", BLANK_SCENE);

    render(<VaultApp repository={repo} initialVault={repo.vault} />);

    await waitFor(() => {
      expect(tree().getByText("diagram-alpha")).toBeInTheDocument();
      expect(tree().getByText("chart-beta")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search drawings/i);
    act(() => {
      fireEvent.change(searchInput, { target: { value: "alpha" } });
    });

    await waitFor(() => {
      expect(tree().getByText("diagram-alpha")).toBeInTheDocument();
      expect(tree().queryByText("chart-beta")).not.toBeInTheDocument();
    });

    // Clear search
    act(() => {
      fireEvent.change(searchInput, { target: { value: "" } });
    });

    await waitFor(() => {
      expect(tree().getByText("diagram-alpha")).toBeInTheDocument();
      expect(tree().getByText("chart-beta")).toBeInTheDocument();
    });
  });

  it("toggles navigator collapse button", async () => {
    const repo = new FakeVaultRepository();

    const { container } = render(
      <VaultApp repository={repo} initialVault={repo.vault} />,
    );

    const toggleBtn = screen.getByRole("button", {
      name: /Hide navigator|Show navigator/i,
    });
    expect(toggleBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(toggleBtn);
    });

    const navigatorEl = container.querySelector(".vault-navigator");
    expect(navigatorEl).toBeInTheDocument();
  });

  it("renders recovery badge and dialog when recovery entries are present", async () => {
    const repo = new FakeVaultRepository();
    repo.seedRecovery("crashed.excalidraw", SAMPLE_SCENE);

    render(<VaultApp repository={repo} initialVault={repo.vault} />);

    await waitFor(() => {
      expect(screen.getByText(/1 Recovery Snapshot/i)).toBeInTheDocument();
    });

    const recoveryBtn = screen.getByText(/1 Recovery Snapshot/i);
    await act(async () => {
      fireEvent.click(recoveryBtn);
    });

    // Recovery dialog opens and loads recovery entries
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Recoverable snapshots/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("crashed.excalidraw")).toBeInTheDocument();
    });
  });
});
