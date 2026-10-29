// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingRow } from "./SettingRow";

describe("SettingRow shows the user's real keys in a description", () => {
  it("replaces the key token with the live binding", () => {
    render(<SettingRow id="layout-header" />);
    const text =
      document.querySelector(".vault-setting-desc")?.textContent ?? "";
    expect(text).not.toContain("{{");
    expect(text).toMatch(/Focus mode \(.+\) hides it too/);
  });
  it("the zoom row names its three keys", () => {
    render(<SettingRow id="interface-zoom" />);
    expect(screen.getByText(/Zoom in \(/)).toBeTruthy();
  });
});
