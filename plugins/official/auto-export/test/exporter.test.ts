import { describe, expect, it, vi } from "vitest";

import { createExporter } from "../src/exporter";

import type { PluginContext } from "@vaultdraw/api";
import type { Config } from "../src/config";

const cfg = {
  folder: "",
  formats: ["svg"],
  scale: 1,
  background: true,
  dark: false,
  skipTag: "",
  notify: false,
  exclude: [],
} as unknown as Config;

const fake = (render: (path: string, to: string) => Promise<unknown>) => {
  const toasts: string[] = [];
  const ctx = {
    log: { warn: vi.fn() },
    ui: { toast: (m: string) => toasts.push(m) },
    vault: { exports: { render } },
    setTimeout: (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return { dispose: () => clearTimeout(id) };
    },
  } as unknown as PluginContext;
  return { exporter: createExporter(ctx, () => cfg), toasts };
};

const conflict = (to: string) =>
  Object.assign(
    new Error(
      `${to} already exists and was not made by an export, so it is left alone`,
    ),
    { code: "CONFLICT" },
  );

describe("an export that meets a file it did not make", () => {
  it("names the file once, plainly, and keeps trying on later saves", async () => {
    const render = vi.fn(async (_p: string, to: string) => {
      throw conflict(to);
    });
    const { exporter, toasts } = fake(render);
    for (let i = 0; i < 3; i++) {
      expect(await exporter.exportNow("Notes/A.excalidraw", false)).toBe(false);
    }
    expect(render).toHaveBeenCalledTimes(3);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("Notes/A.svg");
    expect(toasts[0]).toMatch(/Delete it or rename it/);
    expect(toasts[0]).not.toMatch(/CONFLICT|code/);
  });

  it("tells once for each file, and a conflict does not use up the one other warning", async () => {
    const render = vi.fn(async (p: string, to: string) => {
      if (p.startsWith("B")) {
        throw new Error("disk full");
      }
      throw conflict(to);
    });
    const { exporter, toasts } = fake(render);
    await exporter.exportNow("A.excalidraw", false);
    await exporter.exportNow("C.excalidraw", false);
    await exporter.exportNow("B.excalidraw", false);
    await exporter.exportNow("B.excalidraw", false);
    expect(toasts).toHaveLength(3);
    expect(toasts[0]).toContain("A.svg");
    expect(toasts[1]).toContain("C.svg");
    expect(toasts[2]).toContain("disk full");
  });
});
