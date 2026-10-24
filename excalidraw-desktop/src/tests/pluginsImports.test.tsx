import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ImportsSection } from "../components/settings/pages/Plugins";
import { makePluginInfo } from "../plugins/host/fakeBackend";
import {
  claimImporter,
  resetImporterMap,
  setImporterOverrides,
} from "../plugins/importerMap";

const plugin = (id: string, exts: string[]) =>
  makePluginInfo(id, {
    name: id,
    contributes: {
      commands: [],
      panels: [],
      settings: [],
      importers: [{ id: "txt", title: `${id} text`, extensions: exts }],
    },
  });

afterEach(() => {
  cleanup();
  resetImporterMap();
});

describe("Plugins page: imports", () => {
  it("shows nothing without importers", () => {
    render(<ImportsSection plugins={[makePluginInfo("plain")]} />);
    expect(screen.queryByTestId("plugins-imports")).toBeNull();
  });

  it('lists "Imports: .txt" per plugin', () => {
    render(<ImportsSection plugins={[plugin("a", ["txt", "text"])]} />);
    expect(screen.getByText("a: Imports: .txt, .text")).toBeInTheDocument();
  });

  it("explains a clash, then the config choice and the off state", () => {
    const entry = (id: string) => ({
      pluginId: id,
      importerId: "txt",
      title: id,
    });
    render(
      <ImportsSection plugins={[plugin("a", ["txt"]), plugin("b", ["txt"])]} />,
    );
    act(() => {
      claimImporter(entry("a"), ["txt"]);
      claimImporter(entry("b"), ["txt"]);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      ".txt is claimed by a and b. a imports it.",
    );
    act(() => setImporterOverrides({ txt: "b" }));
    expect(screen.getByRole("alert").textContent).toContain("b imports it");
    act(() => setImporterOverrides({ txt: "" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "not imported by plugins",
    );
  });
});
