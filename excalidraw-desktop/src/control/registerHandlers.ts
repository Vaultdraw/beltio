import type { AskSpec } from "./uriRun";

/** The Rust side's plan: files it would write (and what is there now) and helpers it would run. */
export interface HandlersPlan {
  files: { path: string; state: "new" | "same" | "update" | "foreign" }[];
  commands: string[][];
}

export interface HandlersReport {
  written: string[];
  skipped: string[];
  notes: string[];
}

export interface RegisterDeps {
  invoke: (command: string) => Promise<unknown>;
  ask: (spec: AskSpec) => void;
  notify: (message: string, kind?: "error") => void;
}

const WORDS: Record<HandlersPlan["files"][number]["state"], string> = {
  new: "create",
  same: "already up to date",
  update: "update (it is Vaultdraw's own file)",
  foreign: "leave alone (not created by Vaultdraw)",
};

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Register Vaultdraw for links and files" (Linux, installs no package registers).
 * Nothing is written until the user confirms a dialog that lists every file and
 * program; the backend writes only its two fixed files under the user's data folder.
 */
export async function registerHandlers(d: RegisterDeps): Promise<void> {
  let plan: HandlersPlan;
  try {
    plan = (await d.invoke("links_handlers_plan")) as HandlersPlan;
  } catch (e) {
    d.notify(text(e), "error");
    return;
  }
  if (plan.files.every((f) => f.state === "same" || f.state === "foreign")) {
    d.notify(
      plan.files.some((f) => f.state === "foreign")
        ? "Nothing to do: a file with that name already exists and was not created by Vaultdraw"
        : "Vaultdraw is already registered for links and files",
    );
    return;
  }
  d.ask({
    title: "Register Vaultdraw?",
    message:
      "This tells your desktop that Vaultdraw opens vaultdraw:// links and .excalidraw / .excalidrawlib files. Only your own folders are changed; file types are offered in Open With, not made the default.",
    details: [
      ...plan.files.map((f) => `${WORDS[f.state]}: ${f.path}`),
      ...plan.commands.map((c) => `then run: ${c.join(" ")}`),
    ],
    confirmLabel: "Register",
    onConfirm: () =>
      void d
        .invoke("links_handlers_apply")
        .then((r) => {
          const report = r as HandlersReport;
          d.notify(
            report.notes.length
              ? `Registered (some helper programs failed: ${report.notes.join(
                  "; ",
                )})`
              : "Vaultdraw is registered for links and files",
          );
        })
        .catch((e) => d.notify(text(e), "error")),
  });
}
