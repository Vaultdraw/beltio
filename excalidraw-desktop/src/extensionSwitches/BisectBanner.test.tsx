import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BisectBanner } from "./BisectBanner";
import { setBisect } from "./bisectState";

afterEach(() => setBisect(null));

describe("bisect banner", () => {
  it("is absent without a bisect", () => {
    render(<BisectBanner />);
    expect(screen.queryByTestId("bisect-banner")).toBeNull();
  });

  it("asks during a step and names the culprit at the end", () => {
    setBisect({
      candidates: ["graph", "links"],
      suspects: ["graph"],
      off: ["graph"],
      step: 2,
    });
    render(<BisectBanner />);
    expect(screen.getByTestId("bisect-banner").textContent).toContain("step 2");
    expect(screen.getByTestId("bisect-banner").textContent).toContain(
      "1 of 2 off (Graph view)",
    );
    fireEvent.click(screen.getByRole("button", { name: "It's gone" }));
    expect(screen.getByTestId("bisect-banner").textContent).toContain(
      "Found it: Graph view causes the problem.",
    );
    expect(
      screen.getByRole("button", { name: "Turn Graph view off and restart" }),
    ).toBeTruthy();
  });
});
