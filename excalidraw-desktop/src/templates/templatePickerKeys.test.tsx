import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TemplatePicker } from "./TemplatePicker";

// Bug hunt round 4 (BH-16 family of BH-15): the picker's Enter shortcut sits on the
// dialog wrapper, so Enter on the focused "Open global templates folder" button
// starts a blank drawing instead of opening the folder.
describe("template picker keyboard", () => {
  it("Enter on the focused Open-folder button opens the folder, not a blank drawing", () => {
    const onBlank = vi.fn();
    const onRevealGlobal = vi.fn();
    render(
      <TemplatePicker
        ownerDocument={document}
        vaultName="V"
        vaultTemplates={[]}
        globalTemplates={[]}
        loading={false}
        templatesFolder="Templates"
        renderThumbnail={async () => null}
        onPick={() => {}}
        onBlank={onBlank}
        onClose={() => {}}
        onRevealGlobal={onRevealGlobal}
      />,
    );
    const btn = screen.getByRole("button", {
      name: "Open global templates folder",
    });
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onBlank).not.toHaveBeenCalled();
  });
});
