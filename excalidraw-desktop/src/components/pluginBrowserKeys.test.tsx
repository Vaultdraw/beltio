import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginBrowserDialog } from "./PluginBrowserDialog";

const install = vi.hoisted(() =>
  vi.fn(async () => ({ name: "Foo", review: { state: "ok" } })),
);
const uninstall = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../plugins/host/manage", () => ({
  getPluginsState: () => STATE,
  subscribePluginsState: () => () => {},
  installRegistryPlugin: install,
  uninstallPlugin: uninstall,
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
          api: 0,
          permissions: [],
          sha256: "x",
          url: "u",
        },
      ],
    },
  }),
}));

const STATE = { plugins: [{ id: "foo", version: "1.0.0" }] } as never;

// Bug hunt round 3 (BH-15): the list's Enter shortcut sits on the wrapper of the
// details buttons, so Enter on a focused button runs the shortcut instead.
describe("plugin browser keyboard", () => {
  it("Enter on the focused Uninstall button asks to uninstall, not update", async () => {
    render(<PluginBrowserDialog onClose={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Uninstall" });
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(install).not.toHaveBeenCalled();
  });
});
