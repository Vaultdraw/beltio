import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginBrowserDialog } from "./PluginBrowserDialog";

// Hunter M (2026-10-30 night), toimprove M-5. The plugin browser shows "Needs Vaultdraw 99.0.0 or
// newer" and still offers Install / "Update to 2.0.0". Neither the browser nor the native install
// (`install.rs install_folder`, `registry.rs install_bytes`) compares min_app with the app, so an
// update replaces a working 1.0.0 with a version the loader then refuses (`scan.rs` ->
// `manifest::compatibility`). Reference: Obsidian's community plugins never offer an update whose
// minAppVersion is newer than the running app; the install button says the app must be updated.

const install = vi.hoisted(() =>
  vi.fn(async () => ({ name: "Foo", review: { state: "ok" } })),
);

vi.mock("../plugins/host/manage", () => ({
  getPluginsState: () => STATE,
  subscribePluginsState: () => () => {},
  installRegistryPlugin: install,
  uninstallPlugin: vi.fn(async () => {}),
}));
vi.mock("../theme/install/consent", () => ({
  consentText: () => "",
  grantConsent: async () => true,
  hasConsent: () => true,
}));
vi.mock("../plugins/registry/client", async (orig) => ({
  ...(await orig<typeof import("../plugins/registry/client")>()),
  getRegistryBackend: async () => ({}),
  loadRegistry: async () => ({
    catalogue: {
      entries: [
        {
          id: "foo",
          name: "Foo",
          author: "a",
          description: "d",
          version: "2.0.0",
          api: 1,
          minApp: "99.0.0",
          permissions: [],
          sha256: "x",
          url: "u",
        },
      ],
    },
  }),
}));

const STATE = { plugins: [{ id: "foo", version: "1.0.0" }] } as never;

describe("plugin browser: a version that needs a newer app (toimprove M-5)", () => {
  it("sanity: the details say it needs a newer Vaultdraw", async () => {
    render(<PluginBrowserDialog onClose={() => {}} />);
    expect(
      await screen.findByText("Needs Vaultdraw 99.0.0 or newer."),
    ).toBeTruthy();
  });

  it("the update to a version the app cannot run is not offered", async () => {
    render(<PluginBrowserDialog onClose={() => {}} />);
    const btn = await screen.findByRole("button", {
      name: "Update to 2.0.0",
    });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(install).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Update Vaultdraw to 99.0.0 or newer to update this plugin.",
      ),
    ).toBeTruthy();
  });
});
