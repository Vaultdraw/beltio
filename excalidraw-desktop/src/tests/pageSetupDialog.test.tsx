import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import { PageSetupDialog } from "../components/page/PageSetupDialog";
import { describePageSetup } from "../components/page/pageOptions";
import { getPreferences } from "../vault/preferences";

const state = vi.hoisted(() => ({
  pageSetup: null as PageSetup | null,
  readOnly: false,
  setPageSetup: vi.fn(),
}));

vi.mock("../page/usePageSetup", () => ({
  usePageSetup: () => state,
}));

const mount = (
  setup: PageSetup | null,
  readOnly = false,
  onClose = vi.fn(),
) => {
  state.pageSetup = setup;
  state.readOnly = readOnly;
  render(<PageSetupDialog onClose={onClose} />);
  return onClose;
};

describe("PageSetupDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    state.setPageSetup.mockClear();
  });

  it("turning page mode on from a normal canvas starts from the app default", () => {
    mount(null);
    expect(screen.getByRole("switch", { name: "Page mode" })).not.toBeChecked();
    expect(screen.getByLabelText("Page size")).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Page mode" }));
    expect(state.setPageSetup).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, size: "a4" }),
    );
  });

  it("changing size, theme, layout and orientation calls the setter", () => {
    mount(updatePageSetup(null, {}));
    fireEvent.change(screen.getByLabelText("Page size"), {
      target: { value: "letter" },
    });
    expect(state.setPageSetup).toHaveBeenLastCalledWith({ size: "letter" });
    fireEvent.click(screen.getByRole("button", { name: "Old school" }));
    expect(state.setPageSetup).toHaveBeenLastCalledWith({
      paperTheme: "oldSchool",
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuous" }));
    expect(state.setPageSetup).toHaveBeenLastCalledWith({
      layout: "continuous",
    });
    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));
    expect(state.setPageSetup).toHaveBeenLastCalledWith({
      orientation: "landscape",
    });
  });

  it("custom size shows width and height inputs", () => {
    mount(updatePageSetup(null, { size: "custom", width: 700, height: 900 }));
    const width = screen.getByLabelText("Width");
    expect(width).toHaveValue(700);
    fireEvent.change(width, { target: { value: "800" } });
    fireEvent.blur(width);
    expect(state.setPageSetup).toHaveBeenLastCalledWith({ width: 800 });
  });

  it("Make app default stores the setup; Use app default applies it", () => {
    mount(updatePageSetup(null, { size: "a5", paperTheme: "oldSchool" }));
    fireEvent.click(screen.getByRole("button", { name: "Make app default" }));
    expect(getPreferences()).toMatchObject({
      pageMode: "page",
      pageSize: "a5",
      pagePaperTheme: "old_school",
    });
    fireEvent.click(screen.getByRole("button", { name: "Use app default" }));
    expect(state.setPageSetup).toHaveBeenLastCalledWith(
      expect.objectContaining({ size: "a5", paperTheme: "oldSchool" }),
    );
  });

  it("disables the controls in read-only drawings", () => {
    mount(updatePageSetup(null, {}), true);
    expect(screen.getByRole("switch", { name: "Page mode" })).toBeDisabled();
    expect(screen.getByLabelText("Page size")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Old school" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Use app default" }),
    ).toBeDisabled();
  });

  it("Escape closes and Tab stays inside the dialog", () => {
    const onClose = mount(updatePageSetup(null, {}));
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(
      screen.getByRole("button", { name: "Make app default" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("describePageSetup", () => {
  it("summarises the setup for the menu", () => {
    expect(describePageSetup(null)).toBe("Off");
    expect(describePageSetup(updatePageSetup(null, { enabled: false }))).toBe(
      "Off",
    );
    expect(describePageSetup(updatePageSetup(null, {}))).toBe("A4 · Separate");
    expect(
      describePageSetup(
        updatePageSetup(null, {
          layout: "continuous",
          size: "custom",
          width: 700,
          height: 900,
        }),
      ),
    ).toBe("700×900 · Continuous");
  });
});
