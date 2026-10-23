/**
 * Compile-time checks (tsc, via the root tsconfig) that the app's own copies
 * of public shapes equal the SDK's. A failure here is a type error, not a
 * test failure.
 */
import { describe, expect, it } from "vitest";

import type { PluginInfo } from "../../../excalidraw-desktop/src/plugins/host/types";
import type { SettingDecl as AppSettingDecl } from "../../../excalidraw-desktop/src/plugins/settings/declaredSettings";
import type { PluginSettingValue } from "../../../excalidraw-desktop/src/vault/pluginSettingsTable";
import type {
  PluginContributions,
  SettingDecl,
  SettingValue,
} from "../src/index";

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const assertSame = <_T extends true>() => {};

assertSame<Same<SettingDecl, AppSettingDecl>>();
assertSame<Same<SettingValue, PluginSettingValue>>();
assertSame<Same<PluginContributions, PluginInfo["contributes"]>>();

describe("app and SDK shapes", () => {
  it("are checked by tsc", () => {
    expect(true).toBe(true);
  });
});
