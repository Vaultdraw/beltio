/**
 * Hunter M (2026-10-30 night), toimprove M-18. `ctx.net` exists twice: the app's native rows
 * (`src-tauri/src/plugins/net.rs check_url`, pinned by its test "addresses" table) and the fake the
 * browser harness and the SDK mock host use (`sdk/api/shared/fakeNet.ts`). They have no shared case
 * table (testing.md: "Twins share one case table"), and the fake accepts addresses the app refuses:
 * a plugin's tests (and the app's e2e) pass for a request the real app never sends.
 * The rows live in vaultdraw-core/src/contract/net_address_cases.json, read by net.rs too.
 */
import { describe, expect, it } from "vitest";

import { createFakeNet, fakeNetRow } from "../../../sdk/api/shared/fakeNet";
import table from "../../src-tauri/crates/vaultdraw-core/src/contract/net_address_cases.json";

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

type Row = { url: string; want: string; fake_known?: string };
/** One table for both twins (validator): net.rs runs the same rows in `address_contract_table`. */
const ROWS = table.cases as Row[];

describe("fake ctx.net answers like the app's net.rs (toimprove M-18)", () => {
  ROWS.forEach(({ url, want, fake_known }) => {
    (fake_known ? it.fails : it)(`${url} -> ${want}`, async () => {
      expect(await open(url)).toBe(want);
    });
  });
});
