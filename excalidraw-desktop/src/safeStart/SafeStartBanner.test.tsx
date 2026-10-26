import { afterEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, render, screen } from "@testing-library/react";

import { SafeStartBanner } from "./SafeStartBanner";
import { setSafeStart } from "./state";

import type { SafeStart } from "./state";

const safe = (scope: SafeStart["scope"]): SafeStart => ({
  reason: "env",
  scope,
  crashedLaunches: 0,
  pluginsAtCrash: [],
});

afterEach(() => setSafeStart(null));

describe("SafeStartBanner", () => {
  it("renders nothing in a normal start or in plugin safe mode", () => {
    const { container } = render(<SafeStartBanner />);
    expect(container.firstChild).toBeNull();
    act(() => setSafeStart(safe("plugins")));
    expect(container.firstChild).toBeNull();
  });

  it("shows the reason, the buttons and reacts to the state", () => {
    const restart = vi.fn();
    const open = vi.fn();
    render(<SafeStartBanner onRestartNormally={restart} onOpenConfig={open} />);
    act(() => setSafeStart(safe("core")));
    expect(screen.getByTestId("safe-start-banner").textContent).toContain(
      "Safe start (VAULTDRAW_SAFE is set). Built-in extensions and plugins are off.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart normally" }));
    fireEvent.click(screen.getByRole("button", { name: "Open config folder" }));
    expect(restart).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    act(() => setSafeStart(null));
    expect(screen.queryByTestId("safe-start-banner")).toBeNull();
  });
});
