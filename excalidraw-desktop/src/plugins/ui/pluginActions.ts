/**
 * Plugin management actions shared by the palette and the Plugins settings
 * page. The host is imported on demand so the command registry stays light.
 */
import { toastStore } from "../../toasts/toastStore";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const fail = (what: string, e: unknown) =>
  toastStore.push({ message: `${what}: ${message(e)}`, kind: "error" });

/** Folder picker, install, then tell the user to enable it. */
export async function installPluginFromFolder(): Promise<void> {
  try {
    const manage = await import("../host/manage");
    const path = await manage.pickPluginFolder();
    if (!path) {
      return;
    }
    const info = await manage.installPluginFolder(path);
    toastStore.push({ message: `Installed ${info.name}. Enable it below.` });
  } catch (e) {
    fail("Could not install the plugin", e);
  }
}

/** Rescan the plugins folder. */
export async function reloadPluginList(): Promise<void> {
  try {
    await (await import("../host/manage")).rescanPlugins();
  } catch (e) {
    fail("Could not reload the plugin list", e);
  }
}

/** Show the plugins folder in the file manager (where `vaultdraw-plugin dev` copies a plugin). */
export async function openPluginsFolder(): Promise<void> {
  try {
    await (await import("../host/manage")).openPluginsFolder();
  } catch (e) {
    fail("Could not open the plugins folder", e);
  }
}
