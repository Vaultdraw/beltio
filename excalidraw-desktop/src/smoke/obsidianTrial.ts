/**
 * Packaged Obsidian-vault trial (VITE_APP_OBSIDIAN_TRIAL=true, smoke-test build only; run by
 * `scripts/obsidian-trial.mjs`). Opens the test folder as a vault, runs the real "Import Obsidian
 * vault into a new vault" command (the folder pickers answer from VAULTDRAW_TRIAL_SRC and
 * VAULTDRAW_TRIAL_OUT), waits for it to finish, then opens a sample of the converted drawings.
 * Everything is reported through `smoke_log` / `smoke_finish`; the runner samples memory.
 */
import { invoke } from "@tauri-apps/api/core";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { isSceneReady } from "../editor/sceneReady";

const COMMAND = "markdown-import.obsidian-new-vault";
let bootedByHand: string | null = null;

export async function runObsidianTrial(): Promise<void> {
  const win = window;
  const doc = win.document;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));
  const errors: string[] = [];
  win.addEventListener("error", (e) => errors.push(String(e.message)));
  win.addEventListener("unhandledrejection", (e) =>
    errors.push(`rejection: ${String(e.reason)}`),
  );
  const log = (name: string, details: Record<string, unknown> = {}) =>
    invoke("smoke_log", {
      step: "perf-mark",
      ok: true,
      details: {
        name,
        wallMs: Date.now(),
        perfMs: win.performance.now(),
        ...details,
      },
    }).catch(() => undefined);
  const waitFor = async <T>(
    label: string,
    read: () => T | null | undefined,
    ms: number,
  ) => {
    const until = win.performance.now() + ms;
    while (win.performance.now() < until) {
      const v = read();
      if (v != null) {
        return v;
      }
      await sleep(50);
    }
    throw new Error(`Timed out after ${ms} ms waiting for ${label}`);
  };
  try {
    const environment = await invoke<{ perfSuite?: string }>(
      "smoke_environment",
    ).catch(() => ({ perfSuite: "" }));
    if (environment.perfSuite === "inplace") {
      const { runObsidianInplace } = await import("./obsidianInplace");
      await runObsidianInplace(win, log, errors);
      return;
    }
    const root = await waitFor(
      "app root",
      () => doc.querySelector<HTMLElement>(".vault-app"),
      20_000,
    );
    await waitFor(
      "onboarding",
      () => root.querySelector(".vault-onboarding"),
      20_000,
    );
    await log("interactive");
    const open = Array.from(root.querySelectorAll("button")).find(
      (b) =>
        b.getAttribute("aria-label") === "Open Vault Folder" ||
        b.title === "Open Vault Folder" ||
        b.textContent?.trim() === "Open Vault Folder",
    );
    if (!open) {
      throw new Error("no Open Vault Folder button");
    }
    open.click();
    await waitFor(
      "vault open",
      () => root.querySelector("[data-vault-path]"),
      30_000,
    );
    const handler = await waitFor(
      "import command",
      () => getRegisteredHandler(COMMAND),
      30_000,
    ).catch(async (e: unknown) => {
      // Diagnose, then try once more after booting the plugin stubs by hand (rAF does it in a normal run).
      const { bootPlugins } = await import("../plugins/boot");
      bootPlugins(win);
      await log("trial:booted-by-hand");
      const late = getRegisteredHandler(COMMAND);
      if (late) {
        bootedByHand = String(e);
        return late;
      }
      const host = await import("../plugins/host");
      throw new Error(
        `${String(e)}; visibility=${
          doc.visibilityState
        } focus=${doc.hasFocus()} pluginsEnabled=${JSON.stringify(
          (await import("../vault/preferences")).getPreferences(win)
            .pluginsEnabled,
        )} started=${
          win.performance.getEntriesByName("vaultdraw:plugins:started").length
        } costs=${JSON.stringify(
          host.getPluginCosts(),
        )} problems=${JSON.stringify(
          host.getPluginProblems("markdown-import"),
        )} log=${JSON.stringify(host.getPluginLog("markdown-import")).slice(
          0,
          600,
        )}`,
      );
    });
    await log("trial:import-begin");
    const t0 = win.performance.now();
    void Promise.resolve(handler()).catch((e: unknown) =>
      errors.push(`handler: ${String(e)}`),
    );
    const outcome = await waitFor(
      "import result toast",
      () => {
        const m =
          /(Imported \d+ notes[^\n]*?from [^\n]*?)(?= |$)|Obsidian import failed[^\n]*|Import cancelled[^\n]*/.exec(
            doc.body.textContent ?? "",
          );
        return m ? m[0] : null;
      },
      40 * 60_000,
    );
    const importMs = Math.round(win.performance.now() - t0);
    await log("trial:import-end", { importMs });
    const toastText =
      Array.from(doc.querySelectorAll("*"))
        .filter(
          (el) =>
            el.children.length === 0 &&
            /^Imported \d+ notes/.test(el.textContent ?? ""),
        )
        .map((el) => (el.textContent ?? "").slice(0, 400))[0] ?? outcome;
    // The import opens the new vault: wait for the tree, then open a sample of drawings.
    await sleep(3000);
    const rows = () =>
      Array.from(
        doc.querySelectorAll<HTMLElement>(
          '.vault-tree-item[data-tree-kind="drawing"]',
        ),
      );
    const opened: { path: string; ms: number | null }[] = [];
    for (const row of rows().slice(0, 12)) {
      const path = row.dataset.treePath ?? "";
      const t1 = win.performance.now();
      row.click();
      try {
        await waitFor(
          "scene ready",
          () =>
            isSceneReady(doc.querySelector(".vault-editor")) ? true : null,
          20_000,
        );
        opened.push({
          path: path.replace(/[^/]*\//g, ""),
          ms: Math.round(win.performance.now() - t1),
        });
      } catch {
        opened.push({ path: path.replace(/[^/]*\//g, ""), ms: null });
      }
      await sleep(400);
    }
    await log("trial:done");
    await sleep(1500);
    await invoke("smoke_finish", {
      status: errors.length ? 1 : 0,
      details: {
        trial: {
          bootedByHand,
          importMs,
          toast: toastText,
          treeRows: doc.querySelectorAll(".vault-tree-item").length,
          opened,
          errors,
        },
      },
    });
  } catch (error) {
    await invoke("smoke_finish", {
      status: 1,
      details: { startupFailure: String(error), errors },
    });
  }
}
