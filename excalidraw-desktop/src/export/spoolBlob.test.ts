import { describe, expect, it, vi } from "vitest";

import {
  createWindowMethods,
  type ControlFiles,
} from "../control/windowMethods";

import { emptyCanvasError } from "./exportError";
import { SPOOL_CHUNK_BYTES, spoolBlob } from "./spoolBlob";

const fakeInvoke = (failAt?: number) => {
  const sent: Uint8Array[] = [];
  const calls: string[] = [];
  const invoke = vi.fn(async (cmd: string, args?: unknown, opts?: any) => {
    calls.push(cmd);
    if (cmd === "control_spool_begin") {
      return { id: "a".repeat(32), path: "/state/export-spool/x" };
    }
    if (cmd === "control_spool_append") {
      expect(opts.headers["x-spool-id"]).toBe("a".repeat(32));
      if (calls.filter((c) => c === cmd).length === failAt) {
        throw Object.assign(new Error("disk full"), { code: "IO_ERROR" });
      }
      sent.push(args as Uint8Array);
    }
    return undefined;
  });
  return { invoke, sent, calls };
};

describe("spoolBlob", () => {
  it("sends the blob in order, in chunks of at most 4 MiB, and returns the path", async () => {
    const total = SPOOL_CHUNK_BYTES * 2 + 12345;
    const bytes = new Uint8Array(total);
    for (let i = 0; i < total; i += 4099) {
      bytes[i] = i % 251;
    }
    const { invoke, sent, calls } = fakeInvoke();
    const path = await spoolBlob(invoke, new Blob([bytes]));
    expect(path).toBe("/state/export-spool/x");
    expect(sent.map((c) => c.length)).toEqual([
      SPOOL_CHUNK_BYTES,
      SPOOL_CHUNK_BYTES,
      12345,
    ]);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of sent) {
      joined.set(c, at);
      at += c.length;
    }
    expect(Buffer.compare(joined, bytes)).toBe(0);
    expect(calls).toEqual([
      "control_spool_begin",
      "control_spool_append",
      "control_spool_append",
      "control_spool_append",
    ]);
  });

  it("an empty blob still makes an (empty) spool file", async () => {
    const { invoke, calls } = fakeInvoke();
    await spoolBlob(invoke, new Blob([]));
    expect(calls).toEqual(["control_spool_begin"]);
  });

  it("a failed chunk aborts the spool file and rethrows", async () => {
    const { invoke, calls } = fakeInvoke(2);
    await expect(
      spoolBlob(invoke, new Blob([new Uint8Array(SPOOL_CHUNK_BYTES + 1)])),
    ).rejects.toMatchObject({ message: "disk full" });
    expect(calls.at(-1)).toBe("control_spool_abort");
  });
});

describe("export.spool", () => {
  const files = (blob: Blob): ControlFiles =>
    ({
      vault: () => ({ name: "V", path: "/v", readOnly: false }),
      exportDrawingBlob: vi.fn().mockResolvedValue({
        blob,
        mime: "image/png",
        fileName: "a.png",
      }),
      exportDrawing: vi.fn(),
    } as unknown as ControlFiles);

  it("replies with the spool path and the blob size, never bytes", async () => {
    const f = files(new Blob([new Uint8Array(5)]));
    const spool = vi.fn().mockResolvedValue("/state/export-spool/x");
    const m = createWindowMethods(() => f, spool);
    const r = await m["export.spool"]({
      path: "a.excalidraw",
      format: "png",
    });
    expect(r).toEqual({
      path: "a.excalidraw",
      fileName: "a.png",
      mime: "image/png",
      size: 5,
      spool: "/state/export-spool/x",
    });
    expect(f.exportDrawing).not.toHaveBeenCalled();
  });

  it("has no 32 MiB cap", async () => {
    const big = { size: 40 * 1024 * 1024 } as Blob;
    const m = createWindowMethods(
      () => files(big),
      async () => "/p",
    );
    const r = (await m["export.spool"]({
      path: "a",
      format: "png",
    })) as { size: number };
    expect(r.size).toBe(big.size);
  });

  it("maps an empty canvas the same way as the bytes path", async () => {
    const f = files(new Blob([]));
    (f.exportDrawingBlob as any).mockRejectedValue(emptyCanvasError());
    const m = createWindowMethods(
      () => f,
      async () => "/p",
    );
    await expect(
      m["export.spool"]({ path: "a", format: "png" }),
    ).rejects.toMatchObject({
      code: "INVALID_FILE",
      message: "Cannot export an empty canvas",
    });
  });

  it("refuses spool when the window cannot spool", async () => {
    const m = createWindowMethods(() => files(new Blob([])));
    await expect(
      m["export.spool"]({ path: "a", format: "png" }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
