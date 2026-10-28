import { readFileSync } from "node:fs";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

const ok = (width: number) => ({
  ok: true as const,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20"><path d="M0 0h${width}v20z"/></svg>`,
  width,
  height: 20,
});

vi.mock("../src/renderer", () => ({
  renderFormula: vi.fn(async (req: { source: string }) =>
    req.source.includes("{") && !req.source.includes("}")
      ? { ok: false as const, error: "Missing }" }
      : ok(req.source.length * 10),
  ),
  warmFormulaRenderer: vi.fn(),
  disposeFormulaRenderer: vi.fn(),
}));

let p: TestPlugin | undefined;
afterEach(async () => {
  cleanup();
  await p?.dispose();
  p = undefined;
});

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

/** Types the TeX into the open dialog and presses its confirm button. */
const confirm = async (tex: string, button: string) => {
  fireEvent.change(screen.getByLabelText("LaTeX"), { target: { value: tex } });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: button }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: button }));
};

describe("formula plugin", () => {
  it("keeps the old element data key and the commands", () => {
    const info = manifest();
    expect(info.dataKey).toBe("latex");
    expect(info.contributes.commands.map((c) => c.id)).toEqual([
      "insert",
      "edit",
      "provide",
    ]);
    expect(info.contributes.commands[0].keys).toEqual(["Mod+Shift+M"]);
  });

  it("provides ctx.math: null before the plugin runs, the render after", async () => {
    p = await boot(manifest(), plugin);
    expect(
      await p.renderMath({ source: "x", display: true, color: "#000" }),
    ).toBeNull();
    await p.run("provide");
    const r = await p.renderMath({
      source: "x^2",
      display: true,
      color: "#000",
    });
    expect(r).toMatchObject({ ok: true, width: 30 });
  });

  it("insert opens a modal dialog and adds an image with its TeX under `latex`", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements([]);
    await p.run("insert");
    const overlay = p.overlay()!;
    expect(overlay).not.toBeNull();
    overlay.render();
    expect(screen.getByRole("dialog", { name: "Insert formula" })).toBeTruthy();
    await confirm("x^2", "Insert");
    await waitFor(() => expect(p!.scene.live()).toHaveLength(1));
    const el = p.scene.live()[0] as never as {
      type: string;
      width: number;
      customData: { latex: { source: string; display: boolean } };
    };
    expect(el.type).toBe("image");
    expect(el.width).toBe(30);
    expect(el.customData.latex).toMatchObject({ source: "x^2", display: true });
    expect(p.overlay()).toBeNull();
    expect(Object.values(p.scene.files())[0].mime).toBe("image/svg+xml");
  });

  it("edit redraws the selected formula on the same element, one undo step", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements([]);
    await p.run("insert");
    p.overlay()!.render();
    await confirm("x^2", "Insert");
    cleanup();
    await waitFor(() => expect(p!.scene.live()).toHaveLength(1));
    const first = p.scene.live()[0] as never as {
      id: string;
      x: number;
      width: number;
    };
    const batches = p.scene.batches.length;

    p.scene.select([first.id]);
    await p.run("edit");
    p.overlay()!.render();
    expect((screen.getByLabelText("LaTeX") as HTMLTextAreaElement).value).toBe(
      "x^2",
    );
    await confirm("x^2+y^2", "Save");
    await waitFor(() => expect(p!.scene.batches.length).toBe(batches + 1));
    const live = p.scene.live() as never as {
      id: string;
      customData: { latex: { source: string } };
    }[];
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(first.id);
    expect(live[0].customData.latex.source).toBe("x^2+y^2");
  });

  it("edit with no formula selected says so and opens nothing", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements([{ type: "rectangle" }]);
    await p.run("edit");
    expect(p.overlay()).toBeNull();
    expect(p.toasts().join(" ")).toContain("Select one formula");
  });
});
