import { describe, expect, it } from "vitest";

import contract from "../../src-tauri/crates/vaultdraw-core/src/contract/vault_ops.json";

import { FakeVaultRepository } from "./fakeVaultRepository";

/**
 * FakeVaultRepository (the browser e2e backend) must answer like the native vault operations:
 * the same table drives `src-tauri/src/vault_ops_contract.rs`. A refusal the backend has and the
 * fake lacks is invisible to every Playwright test (bug hunt BH-9, toimprove 89 and 100).
 */
type Op = {
  kind: "createFolder" | "move" | "trash" | "writeDrawing" | "listDirectory";
  path?: string;
  from?: string;
  to?: string;
  base?: "none" | "current" | "stale";
  names?: string[];
};
type Case = {
  name: string;
  disk: Record<string, string>;
  op: Op;
  expect: string;
  after?: Record<string, "exists" | "missing">;
};

const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
});

const exists = async (repo: FakeVaultRepository, path: string) => {
  const folder = path.endsWith("/");
  const clean = folder ? path.slice(0, -1) : path;
  const at = clean.lastIndexOf("/");
  const dir = at < 0 ? "" : clean.slice(0, at);
  try {
    const entries = await repo.listDirectory(repo.handle, dir);
    return entries.some((e) => e.path === clean);
  } catch {
    return false;
  }
};

const run = async (repo: FakeVaultRepository, op: Op): Promise<string> => {
  const h = repo.handle;
  try {
    switch (op.kind) {
      case "createFolder":
        await repo.createFolder(h, op.path!);
        break;
      case "move":
        await repo.move(h, op.from!, op.to!);
        break;
      case "trash":
        await repo.trash(h, op.path!);
        break;
      case "writeDrawing": {
        let expectedRevision: string | null = null;
        if (op.base !== "none") {
          expectedRevision = "0".repeat(64);
          if (op.base === "current") {
            expectedRevision = (await repo.readDrawing(h, op.path!)).revision;
          }
        }
        await repo.writeDrawing({
          handle: h,
          path: op.path!,
          json: SCENE,
          expectedRevision,
          operationId: "contract-op",
        });
        break;
      }
      case "listDirectory": {
        const names = (await repo.listDirectory(h, op.path!)).map(
          (e) => e.name,
        );
        if (op.names && JSON.stringify(names) !== JSON.stringify(op.names)) {
          return `listed ${JSON.stringify(names)}, expected ${JSON.stringify(
            op.names,
          )}`;
        }
        break;
      }
    }
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe("FakeVaultRepository follows the native vault operations contract", () => {
  it.each((contract.cases as Case[]).map((c) => [c.name, c] as const))(
    "%s",
    async (_name, c) => {
      const repo = new FakeVaultRepository();
      for (const [p, text] of Object.entries(c.disk)) {
        if (p.endsWith("/")) {
          repo.seedFolder(p.slice(0, -1));
        } else if (p.endsWith(".md")) {
          repo.seedNote(p);
        } else {
          repo.seedDrawing(p, SCENE);
        }
        void text;
      }
      expect(await run(repo, c.op)).toBe(c.expect);
      for (const [p, state] of Object.entries(c.after ?? {})) {
        expect(await exists(repo, p), `${p} should be ${state}`).toBe(
          state === "exists",
        );
      }
    },
  );
});
