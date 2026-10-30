/**
 * Twins (testing.md): which IP literals a download may never reach is decided twice, by the desktop
 * app's network guard (src-tauri/src/network.rs `is_blocked_address`) and by the webview download
 * paths (network/webFetchGuard.ts `isLocalOrPrivateHost`, c3f77a3d). One case table pins both; Rust
 * runs the same rows in `network::private_host_contract`. A row with `ts_known` is a gap in the
 * TypeScript copy (toimprove 268) and flips to a pass when fixed (validator, 2026-10-30 night).
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/private_host_cases.json";
import { isLocalOrPrivateHost } from "../network/webFetchGuard";

type Row = { host: string; blocked: boolean; ts_known?: string };

describe("private host contract (desktop guard and webview guard agree)", () => {
  for (const row of table.cases as Row[]) {
    (row.ts_known ? it.fails : it)(
      `${row.host} is ${row.blocked ? "refused" : "allowed"}`,
      () => {
        // The host as a URL gives it, so the row tests what the guard really sees.
        const host = new URL(`https://${row.host}/a.json`).hostname;
        expect(isLocalOrPrivateHost(host)).toBe(row.blocked);
      },
    );
  }
});
