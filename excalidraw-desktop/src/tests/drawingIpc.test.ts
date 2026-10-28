import { describe, expect, it, vi } from "vitest";

import { DesktopVaultRepository } from "../vault/DesktopVaultRepository";

const REVISION = "a".repeat(64);
const frame = (json: string, revision = REVISION): ArrayBuffer => {
  const bytes = new TextEncoder().encode(`${revision}\n${json}`);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
};

describe("drawing IPC framing", () => {
  it("splits the read frame into revision and json (multi-byte safe)", async () => {
    const json = '{"type":"excalidraw","text":"héllo ✓ \\n 日本"}';
    const invoke = vi.fn().mockResolvedValue(frame(json));
    const repo = new DesktopVaultRepository({ invoke });
    await expect(repo.readDrawing("h", "a.excalidraw")).resolves.toEqual({
      json,
      revision: REVISION,
    });
    expect(invoke).toHaveBeenCalledWith("read_drawing", {
      handle: "h",
      path: "a.excalidraw",
    });
  });

  it("reads the read-only mark (a carriage return after the revision)", async () => {
    const json = '{"type":"excalidraw"}';
    const bytes = new TextEncoder().encode(`${REVISION}\r${json}`);
    const invoke = vi.fn().mockResolvedValue(bytes.buffer);
    const repo = new DesktopVaultRepository({ invoke });
    await expect(repo.readDrawing("h", "a.excalidraw")).resolves.toEqual({
      json,
      revision: REVISION,
      readOnly: true,
    });
    invoke.mockResolvedValue(true);
    await expect(repo.readOnlyState("h", "a.excalidraw")).resolves.toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("drawing_read_only", {
      handle: "h",
      path: "a.excalidraw",
    });
  });

  it("rejects a malformed read response", async () => {
    const repo = new DesktopVaultRepository({
      invoke: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
    });
    await expect(repo.readDrawing("h", "a.excalidraw")).rejects.toMatchObject({
      code: "INVALID_FILE",
    });
  });

  it("writes the scene as a raw UTF-8 body with percent-encoded headers", async () => {
    const invoke = vi.fn().mockResolvedValue({ revision: "r2" });
    const repo = new DesktopVaultRepository({ invoke });
    const json = '{"type":"excalidraw","n":"✓"}';
    await expect(
      repo.writeDrawing({
        handle: "h/1",
        path: "föld er/a b.excalidraw",
        json,
        expectedRevision: "r1",
        operationId: "op 1",
      }),
    ).resolves.toEqual({ revision: "r2" });
    const [command, body, options] = invoke.mock.calls[0];
    expect(command).toBe("write_drawing");
    // Tauri only sends a raw body for a top-level ArrayBuffer / typed array.
    expect(ArrayBuffer.isView(body)).toBe(true);
    expect(new TextDecoder().decode(body)).toBe(json);
    expect(options.headers).toEqual({
      "x-handle": "h%2F1",
      "x-path": encodeURIComponent("föld er/a b.excalidraw"),
      "x-expected-revision": "r1",
      "x-operation-id": "op%201",
    });
  });

  it("sends an empty expected-revision header for create-only writes", async () => {
    const invoke = vi.fn().mockResolvedValue({ revision: "r" });
    const repo = new DesktopVaultRepository({ invoke });
    await repo.writeDrawing({
      handle: "h",
      path: "a.excalidraw",
      json: "{}",
      expectedRevision: null,
      operationId: "op",
    });
    expect(invoke.mock.calls[0][2].headers["x-expected-revision"]).toBe("");
  });

  it("readRevision calls the light command and passes null through", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const repo = new DesktopVaultRepository({ invoke });
    await expect(repo.readRevision("h", "a.excalidraw")).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("drawing_revision", {
      handle: "h",
      path: "a.excalidraw",
    });
  });
});
