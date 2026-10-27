import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FormulaDialog from "./FormulaDialog";
import { renderFormula, warmFormulaRenderer } from "./renderer";

vi.mock("./renderer", () => ({
  renderFormula: vi.fn(),
  warmFormulaRenderer: vi.fn(),
}));

const mocked = vi.mocked(renderFormula);
const ok = (w = 40) => ({
  ok: true as const,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20"/>`,
  width: w,
  height: 20,
});

const setup = () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <FormulaDialog
      mode="insert"
      color="#1e1e1e"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel, box: screen.getByLabelText("LaTeX") };
};

const type = async (box: HTMLElement, value: string, ms = 130) => {
  fireEvent.change(box, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocked.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("FormulaDialog", () => {
  it("is labelled, warms the renderer and disables Insert when empty", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Insert formula" })).toBeTruthy();
    expect(warmFormulaRenderer).toHaveBeenCalled();
    expect((screen.getByText("Insert") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("debounces renders by 120 ms", async () => {
    mocked.mockResolvedValue(ok());
    const { box } = setup();
    fireEvent.change(box, { target: { value: "a" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(box, { target: { value: "ab" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mocked).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked.mock.calls[0][0].source).toBe("ab");
    expect((screen.getByText("Insert") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByAltText("Formula preview")).toBeTruthy();
  });

  it("ignores stale responses", async () => {
    let first!: (v: ReturnType<typeof ok>) => void;
    mocked.mockImplementationOnce(() => new Promise((r) => (first = r)));
    mocked.mockResolvedValueOnce(ok(60));
    const { box, onConfirm } = setup();
    await type(box, "a");
    await type(box, "b");
    await act(async () => first(ok(10)));
    fireEvent.click(screen.getByText("Insert"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      source: "b",
      width: 60,
    });
  });

  it("shows errors and disables confirm", async () => {
    mocked.mockResolvedValue({
      ok: false,
      error: "Undefined control sequence",
    });
    const { box, onConfirm } = setup();
    await type(box, "\\bad");
    expect(screen.getByRole("alert").textContent).toContain("Undefined");
    const btn = screen.getByText("Insert") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with Cmd+Enter, stripping $$ delimiters into display mode", async () => {
    mocked.mockResolvedValue(ok());
    const { box, onConfirm } = setup();
    await type(box, "$x^2$");
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      source: "x^2",
      display: false,
    });
  });

  it("keeps the last preview (dimmed) while the next one renders", async () => {
    let second!: (v: ReturnType<typeof ok>) => void;
    mocked.mockResolvedValueOnce(ok(40));
    mocked.mockImplementationOnce(() => new Promise((r) => (second = r)));
    const { box } = setup();
    await type(box, "a");
    const img = screen.getByAltText("Formula preview") as HTMLImageElement;
    const first = img.src;
    await type(box, "ab");
    const stale = screen.getByAltText("Formula preview") as HTMLImageElement;
    expect(stale).toBe(img);
    expect(stale.src).toBe(first);
    expect(stale.className).toBe("is-stale");
    await act(async () => second(ok(80)));
    expect(img.src).not.toBe(first);
    expect(img.className).toBe("");
  });

  it("Cmd+Enter before the preview settles renders and inserts the latest text", async () => {
    mocked.mockResolvedValue(ok(30));
    const { box, onConfirm } = setup();
    fireEvent.change(box, { target: { value: "y^3" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", metaKey: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ source: "y^3" });
  });

  it("cancels on Escape", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
