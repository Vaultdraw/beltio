/**
 * The plugin host's registry side: reconciles the plugin list and the enabled
 * ids into stub registrations. Disabled, incompatible or host-disabled
 * plugins register nothing.
 */
import { allRuntimes, ensureRuntime, stopPlugin } from "./activation";
import { recordStubRegistration } from "./cost";
import { registerStubs } from "./stubs";

import type { PluginInfo } from "./types";

const wanted = (
  info: PluginInfo,
  enabled: ReadonlySet<string>,
  state: string,
) =>
  enabled.has(info.id) &&
  info.compatible &&
  !info.hostDisabled &&
  state !== "disabled";

/** Ids whose stubs were registered by this call (candidates for startup activation). */
export function syncPlugins(
  infos: readonly PluginInfo[],
  enabledIds: readonly string[],
): { started: string[] } {
  const enabled = new Set(enabledIds);
  const started: string[] = [];
  let registerMs = 0;
  const present = new Set<string>();
  for (const info of infos) {
    present.add(info.id);
    const rt = ensureRuntime(info);
    const want = wanted(rt.info, enabled, rt.state);
    if (want && !rt.disposeStubs) {
      const t0 = performance.now();
      rt.disposeStubs = registerStubs(rt);
      registerMs += performance.now() - t0;
      started.push(info.id);
    } else if (!want && rt.disposeStubs) {
      void stopPlugin(rt);
    }
  }
  for (const rt of allRuntimes()) {
    if (!present.has(rt.info.id) && rt.disposeStubs) {
      void stopPlugin(rt);
    }
  }
  recordStubRegistration(registerMs);
  return { started };
}

export { ensureActive, getRuntime } from "./activation";
export { getPluginCosts, getStubRegistrationMs } from "./cost";
export { getPluginLog, getPluginProblems } from "./errors";
