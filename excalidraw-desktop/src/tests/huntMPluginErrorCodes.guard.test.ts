import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hunter M (2026-10-30 night), toimprove M-12. API 1.0 made `PluginErrorCode` public and pinned
 * (sdk/docs/stability.md: "The error codes (PluginErrorCode) a call may reject with" are covered).
 * The host passes every native code straight through (`plugins/host/gateway.ts toApiError`), so a
 * plugin also receives codes that are not in the union: `INTERNAL` (gateway.rs RpcError fallback,
 * mod.rs join errors, "Search service unavailable") and `TRASH_FAILED` (exports.rs, removing an
 * export). A plugin written against the types (an exhaustive `switch (e.code)`) is told those
 * cannot happen. Either list them, or map them to a listed code at the gateway.
 */
const REPO = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const union = new Set(
  [
    ...read("sdk/api/src/errors.ts")
      .split("export type PluginErrorCode")[1]
      .split(";")[0]
      .matchAll(/"([A-Z_]+)"/g),
  ].map((m) => m[1]),
);

/** Rust files whose errors reach a plugin through plugin_call / plugin_call_raw. */
const REACHABLE = [
  "excalidraw-desktop/src-tauri/src/plugins/gateway.rs",
  "excalidraw-desktop/src-tauri/src/plugins/mod.rs",
  "excalidraw-desktop/src-tauri/src/plugins/exports.rs",
  "excalidraw-desktop/src-tauri/src/plugins/net.rs",
];

const missing = (file: string) => [
  ...new Set(
    [
      ...read(file)
        // Production code only: test modules sit at the end of each file.
        .split(/#\[cfg\(test\)\]\nmod /)[0]
        .matchAll(/(?:GatewayError::new|err)\("([A-Z][A-Z_]+)"/g),
    ]
      .map((m) => m[1])
      .filter((c) => !union.has(c)),
  ),
];

describe("every code a plugin call rejects with is in PluginErrorCode (toimprove M-12)", () => {
  it("(context) the union parsed and has the documented codes", () => {
    expect(union.has("NOT_FOUND")).toBe(true);
    expect(union.size).toBeGreaterThanOrEqual(19);
  });

  it("(context) today's unlisted codes, so a new one is noticed", () => {
    expect([...new Set(REACHABLE.flatMap(missing))].sort()).toEqual([
      "INTERNAL",
      "INVALID_URL",
      "NETWORK_TIMEOUT",
      "PRIVATE_ADDRESS",
      "SECRET_MISSING",
      "TOO_MANY_STREAMS",
      // TRASH_FAILED is gone: an export's Trash failure is IO_ERROR (toimprove 262, part 1).
      // The rest need the union extended, a minor API version (left for the plugins team).
    ]);
  });

  // API 1.1 (617d9364): ctx.net's own doc comment lists the codes it rejects with.
  it.fails("every code ctx.net documents is in the union", () => {
    const doc = read("sdk/api/src/net.ts")
      .split("Error codes:")[1]
      .split("*/")[0];
    const named = [...doc.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((c) => !union.has(c))).toEqual([]);
  });

  it.fails("no plugin-reachable native code is missing from the union", () => {
    expect(REACHABLE.flatMap(missing)).toEqual([]);
  });
});
