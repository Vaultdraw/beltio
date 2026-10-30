/**
 * Hunter M (2026-10-30 night), toimprove M-18. `ctx.net` exists twice: the app's native rows
 * (`src-tauri/src/plugins/net.rs check_url`, pinned by its test "addresses" table) and the fake the
 * browser harness and the SDK mock host use (`sdk/api/shared/fakeNet.ts`). They have no shared case
 * table (testing.md: "Twins share one case table"), and the fake accepts addresses the app refuses:
 * a plugin's tests (and the app's e2e) pass for a request the real app never sends.
 * The rows below are the Rust table's rows, as written there.
 */
import { describe, expect, it } from "vitest";

import { createFakeNet, fakeNetRow } from "../../../sdk/api/shared/fakeNet";

const enc = new TextEncoder();
const open = async (url: string): Promise<string> => {
  const fake = createFakeNet();
  fake.respond = () => ({ chunks: [] });
  try {
    await fakeNetRow(
      fake,
      "t-addr",
      "net.open",
      enc.encode(JSON.stringify({ url })),
    );
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

const RUST_ROWS: [string, string][] = [
  ["http://192.168.1.5/x", "INVALID_URL"],
  ["http://example.com/x", "INVALID_URL"],
  ["ftp://example.com/x", "INVALID_URL"],
  ["https://user:pw@example.com/x", "INVALID_URL"],
  ["not a url", "INVALID_URL"],
  ["https://10.0.0.1/x", "PRIVATE_ADDRESS"],
  ["https://169.254.169.254/x", "PRIVATE_ADDRESS"],
  ["https://[fd00::1]/x", "PRIVATE_ADDRESS"],
  ["http://localhost:11434/api", "ok"],
  ["https://127.0.0.1/api", "ok"],
  ["http://[::1]:8080/api", "ok"],
  ["https://api.openai.com/v1/chat", "ok"],
];

/** Rows the fake answers differently today (flip each when the twins share a table). */
const DRIFT = new Set([
  "https://user:pw@example.com/x", // fake: ok
  "not a url", // fake: Node's ERR_INVALID_URL, not a PluginApiError code
  "https://10.0.0.1/x", // fake: ok
  "https://169.254.169.254/x", // fake: ok
  "https://[fd00::1]/x", // fake: ok
]);

describe("fake ctx.net answers like the app's net.rs (toimprove M-18)", () => {
  RUST_ROWS.forEach(([url, want]) => {
    (DRIFT.has(url) ? it.fails : it)(`${url} -> ${want}`, async () => {
      expect(await open(url)).toBe(want);
    });
  });
});
