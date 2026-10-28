/**
 * How plugins (and anything outside React) run a command by id: through the
 * shell's command runner when VaultApp has registered it (same path as the
 * palette: availability + dispatcher), else the registered handler layers.
 */
import { resolveCommandId } from "../../commands/aliases";
import { getAppCommandRunner } from "../../commands/appRunner";
import { runHandler } from "../../commands/dispatcher";
import { getRegisteredHandler } from "../../commands/handlerRegistry";

export async function runCommandById(oldId: string): Promise<void> {
  const id = resolveCommandId(oldId);
  const runner = getAppCommandRunner();
  if (runner) {
    if (!runner(id)) {
      throw new Error(`Command "${id}" is unknown or not available now`);
    }
    return;
  }
  const handler = getRegisteredHandler(id);
  if (!handler) {
    throw new Error(`Command "${id}" is unknown or not available now`);
  }
  runHandler(id, handler);
}
