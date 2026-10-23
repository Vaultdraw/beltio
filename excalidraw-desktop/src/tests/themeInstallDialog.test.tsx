import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ThemeInstallDialog } from "../components/ThemeInstallDialog";
import { getPreferences, updatePreferences } from "../vault/preferences";
import { setThemeRegistry } from "../theme/registry";

import type { InstallBackend } from "../theme/install/types";

const THEME = JSON.stringify({
  name: "Midnight",
  dark: { mSurface: "#101820", mOnSurface: "#e8e8e8", mPrimary: "#4aa3ff" },
});

let backend: InstallBackend;
vi.mock("../theme/install/backends", () => ({
  getInstallBackend: async () => backend,
}));

const makeBackend = (over: Partial<InstallBackend> = {}): InstallBackend => ({
  resolve: vi.fn(async () => ({
    kind: "file" as const,
    name: "Midnight",
    json: THEME,
    sha256: "h",
    url: "https://example.com/Midnight.json",
  })),
  fetch: vi.fn(),
  write: vi.fn(async (r) => ({ name: r.name })),
  installed: vi.fn(async () => []),
  updateFetch: vi.fn(),
  uninstall: vi.fn(async () => {}),
  ...over,
});

const prefs = (patch: Record<string, unknown>) =>
  act(() => {
    updatePreferences(patch);
  });

beforeEach(() => {
  backend = makeBackend();
});
afterEach(() => {
  setThemeRegistry(null);
  prefs({ networkEnabled: true, networkAllowThemes: undefined });
});

describe("ThemeInstallDialog (install)", () => {
  it("asks for consent first, saves Allow, then installs a file after a confirm step", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: undefined });
    const onClose = vi.fn();
    render(
      <ThemeInstallDialog request={{ mode: "install" }} onClose={onClose} />,
    );

    expect(screen.getByTestId("theme-install-consent")).toBeTruthy();
    expect(backend.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(getPreferences().networkAllowThemes).toBe(true);

    fireEvent.change(await screen.findByLabelText("Address or GitHub repo"), {
      target: { value: "https://example.com/Midnight.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    await screen.findByText("Midnight");
    expect(backend.write).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await screen.findByTestId("theme-install-done");
    expect(backend.write).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Midnight", replace: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect(getPreferences().colorTheme).toBe("Midnight");
    expect(onClose).toHaveBeenCalled();
  });

  it("Not now closes without any request", () => {
    prefs({ networkEnabled: true, networkAllowThemes: undefined });
    const onClose = vi.fn();
    render(
      <ThemeInstallDialog request={{ mode: "install" }} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalled();
    expect(backend.resolve).not.toHaveBeenCalled();
  });

  it("says when the master switch is off and Allow turns it back on", () => {
    prefs({ networkEnabled: false, networkAllowThemes: true });
    render(
      <ThemeInstallDialog request={{ mode: "install" }} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("theme-install-consent").textContent).toMatch(
      /switched off/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(getPreferences().networkEnabled).toBe(true);
  });

  it("shows a lookup error and stays on the input", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: true });
    backend = makeBackend({
      resolve: vi.fn(async () => {
        throw Object.assign(new Error("example.com answered 404"), {
          code: "HTTP_STATUS",
        });
      }),
    });
    render(
      <ThemeInstallDialog
        request={{ mode: "install", input: "https://example.com/x.json" }}
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/404/);
    expect(screen.getByLabelText("Address or GitHub repo")).toBeTruthy();
  });

  it("offers Replace / Keep both on a name clash", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: true });
    const write = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("exists"), { code: "THEME_EXISTS" }),
      )
      .mockImplementation(async (r) => ({ name: r.name }));
    backend = makeBackend({
      write,
      installed: vi.fn(async () => [
        { name: "Midnight", source: { sha256: "x" } },
      ]),
    });
    render(
      <ThemeInstallDialog
        request={{
          mode: "install",
          input: "https://example.com/Midnight.json",
        }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep both" }));
    await screen.findByTestId("theme-install-done");
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Midnight 2", replace: false }),
    );
  });

  it("picks from a repo listing and goes straight to the named theme", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: true });
    backend = makeBackend({
      resolve: vi.fn(async () => ({
        kind: "repo" as const,
        owner: "Vaultdraw",
        repo: "themes",
        commit: "abc1234",
        ref: "dev",
        themes: [
          { name: "Midnight", path: "Midnight/Midnight.json" },
          { name: "Other", path: "Other/Other.json" },
        ],
      })),
      fetch: vi.fn(async () => ({ json: THEME, sha256: "h", url: "u" })),
    });
    render(
      <ThemeInstallDialog
        request={{
          mode: "install",
          input: "Vaultdraw/themes",
          pick: "Midnight",
        }}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Install" });
    expect(backend.fetch).toHaveBeenCalledWith(
      {
        kind: "repo",
        owner: "Vaultdraw",
        repo: "themes",
        commit: "abc1234",
        path: "Midnight/Midnight.json",
      },
      65536,
    );
    // The branch it came from is kept, so updates follow it.
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await screen.findByTestId("theme-install-done");
    expect(backend.write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ ref: "dev", commit: "abc1234" }),
      }),
    );
  });
});

describe("ThemeInstallDialog (manage)", () => {
  it("lists installed themes and removes one without any network consent", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: undefined });
    backend = makeBackend({
      installed: vi.fn(async () => [
        { name: "Midnight", source: { sha256: "x" } },
      ]),
    });
    render(
      <ThemeInstallDialog request={{ mode: "uninstall" }} onClose={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(backend.uninstall).toHaveBeenCalledWith("Midnight"),
    );
  });

  it("checks for updates and applies one", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: true });
    backend = makeBackend({
      installed: vi.fn(async () => [
        {
          name: "Midnight",
          source: { url: "https://example.com/Midnight.json", sha256: "old" },
        },
      ]),
      updateFetch: vi.fn(async () => ({
        changed: true,
        json: THEME,
        sha256: "new",
      })),
    });
    render(
      <ThemeInstallDialog request={{ mode: "update" }} onClose={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    await waitFor(() =>
      expect(backend.write).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Midnight", replace: true }),
      ),
    );
    await screen.findByText("Up to date");
  });
});
