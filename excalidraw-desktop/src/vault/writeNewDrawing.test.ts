import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";
import { userError } from "../components/userError";

import { writeNewDrawing } from "./writeNewDrawing";

const SCENE =
  '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}';

describe("writeNewDrawing", () => {
  it("creates once, then names the clash in plain words", async () => {
    const repo = new FakeVaultRepository();
    const input = {
      handle: repo.handle,
      path: "Sub/a.excalidraw",
      json: SCENE,
      operationId: "op",
    };
    repo.seedFolder("Sub");
    await writeNewDrawing(repo, input);
    const error = await writeNewDrawing(repo, input).catch((e) => e);
    expect(error.code).toBe("NAME_COLLISION");
    expect(userError(error)).toBe(
      "A file named “a.excalidraw” already exists here.",
    );
  });

  it("passes other errors through", async () => {
    const repo = new FakeVaultRepository();
    const error = await writeNewDrawing(repo, {
      handle: repo.handle,
      path: "x.md",
      json: SCENE,
      operationId: "op",
    }).catch((e) => e);
    expect(error.code).toBe("INVALID_PATH");
  });
});
