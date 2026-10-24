import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// settingsSync first: it and the command registry import each other.
import "../vault/settingsSync";

import {
  CONFIG_COMMAND_HANDLERS,
  CONFIG_COMMAND_IDS,
  closeReport,
  openReport,
} from "../commands/configCommands";
import { ReportDialog } from "../components/ReportDialog";
import { ReportDialogHost } from "../components/ReportDialogHost";

afterEach(() => closeReport());

describe("report dialog", () => {
  it("shows the text, copies it, and closes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onClose = vi.fn();
    render(
      <ReportDialog
        title="Config check"
        text="config.toml:3:1: warning: x"
        tone="warning"
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Config check" })).toBeTruthy();
    expect(screen.getByText("config.toml:3:1: warning: x")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith("config.toml:3:1: warning: x");
    expect(screen.getByRole("status").textContent).toBe("Copied");
    fireEvent.click(screen.getByText("Close", { selector: "button" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the host renders an opened report lazily and closes it", async () => {
    render(<ReportDialogHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openReport({ title: "Debug info", text: "hello", tone: "ok" }));
    expect(
      await screen.findByRole("dialog", { name: "Debug info" }),
    ).toBeTruthy();
    act(() => closeReport());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a new report starts fresh: no stale Copied status", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<ReportDialogHost />);
    act(() => openReport({ title: "Config check", text: "a", tone: "ok" }));
    await screen.findByRole("dialog", { name: "Config check" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByRole("status").textContent).toBe("Copied");
    act(() => openReport({ title: "Debug info", text: "b", tone: "ok" }));
    await screen.findByRole("dialog", { name: "Debug info" });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("config check commands", () => {
  it("are registered with handlers", () => {
    for (const id of [CONFIG_COMMAND_IDS.check, CONFIG_COMMAND_IDS.debugInfo]) {
      expect(CONFIG_COMMAND_HANDLERS[id], id).toBeTypeOf("function");
    }
  });
});
