/**
 * Window side of `vaultdraw://` links. Rust parsed and checked the link (see
 * src-tauri/src/control/uri.rs) and sends a plan; this runs it through the
 * same window methods the control socket uses (file.open, file.create,
 * vault.open, command.run). Pure: every effect is injected.
 *
 * Rules (security): open and search run at once; switching vault, `new` and
 * `cmd` ask first unless the plan says they were pre-approved (`allowed`,
 * `allowSwitch`, from `control.uri_allow`). One modal lists everything the
 * link wants. `vault` is matched by folder name against the open and recent
 * vaults only. Run returns at once with `asking`; it never waits for a person.
 */
import { ControlError } from "./errors";
import { withExt } from "./params";

export type UriAction = "focus" | "open" | "search" | "new" | "cmd" | "notice";

export interface UriPlan {
  action: UriAction;
  vault?: string;
  file?: string;
  path?: string;
  query?: string;
  id?: string;
  newTab?: boolean;
  /** `notice` only: what to tell the user. */
  message?: string;
  /** `new` / `cmd` may run without asking. */
  allowed?: boolean;
  /** Switching vault may happen without asking. */
  allowSwitch?: boolean;
  origin?: string;
}

export interface AskSpec {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  onConfirm: () => void;
}

export interface UriDeps {
  /** A window method (the table `createWindowMethods` returns plus command.run). */
  call: (method: string, params: unknown) => Promise<unknown>;
  vault: () => { name: string; path: string } | null;
  recentVaults: () => readonly string[];
  /** The command's title, or null when no such command exists. */
  commandTitle: (id: string) => string | null;
  openSearch: (query: string) => void;
  ask: (spec: AskSpec) => void;
  notify: (message: string, kind?: "error") => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type UriResult = { status: "done" | "asking" };

/** How long a link waits for the vault to load on a cold start. */
export const VAULT_WAIT_MS = 10_000;
const POLL_MS = 50;
const SHOWN_CHARS = 200;

const clip = (s: string): string =>
  s.length > SHOWN_CHARS ? `${s.slice(0, SHOWN_CHARS)}…` : s;

const baseName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const trimSlash = (path: string): string => path.replace(/[\\/]+$/, "");

export function createUriRunner(deps: UriDeps) {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  const waitFor = async (cond: () => boolean): Promise<boolean> => {
    const end = now() + VAULT_WAIT_MS;
    while (!cond()) {
      if (now() >= end) {
        return false;
      }
      await sleep(POLL_MS);
    }
    return true;
  };

  /** Tells the user, then throws the same error for a socket caller. */
  const fail = (code: string, message: string, data?: unknown): never => {
    deps.notify(message, "error");
    throw new ControlError(code, message, data);
  };

  const resolveVault = (name: string): { name: string; path: string } => {
    const open = deps.vault();
    const paths = new Map<string, string>();
    for (const p of [open?.path, ...deps.recentVaults()]) {
      if (p) {
        paths.set(trimSlash(p), p);
      }
    }
    const hits = [...paths.values()].filter(
      (p) => baseName(p).toLowerCase() === name.toLowerCase(),
    );
    if (hits.length === 0) {
      return fail(
        "NOT_FOUND",
        `No vault named "${clip(name)}" among your recent vaults`,
        { vault: name },
      );
    }
    if (hits.length > 1) {
      return fail(
        "CONFLICT",
        `Several recent vaults are named "${clip(
          name,
        )}": open the one you want first`,
        { vault: name },
      );
    }
    return { name: baseName(hits[0]), path: hits[0] };
  };

  const isNotFound = (e: unknown) =>
    (e as { code?: unknown } | null)?.code === "NOT_FOUND";

  /** Opens `path` if it exists; false when there is no such drawing. */
  const openIfExists = async (
    path: string,
    newTab: boolean,
  ): Promise<boolean> => {
    try {
      await deps.call("file.open", { path, newTab });
      return true;
    } catch (e) {
      if (isNotFound(e)) {
        return false;
      }
      throw e;
    }
  };

  async function run(plan: UriPlan): Promise<UriResult> {
    switch (plan.action) {
      case "notice":
        deps.notify(clip(plan.message ?? ""));
        return { status: "done" };
      case "focus":
        return { status: "done" };
      case "open":
      case "search":
      case "new":
      case "cmd":
        return act(plan);
      default:
        return fail("INVALID_PARAMS", "Unknown link action");
    }
  }

  async function act(plan: UriPlan): Promise<UriResult> {
    let target: { name: string; path: string } | null = null;
    let needSwitch = false;
    const loaded = await waitFor(() => deps.vault() !== null);
    if (plan.vault) {
      target = resolveVault(plan.vault);
      const open = deps.vault();
      needSwitch = !open || trimSlash(open.path) !== trimSlash(target.path);
    } else if (!loaded) {
      return fail("NO_VAULT", "No vault is open");
    }

    const lines: string[] = [];
    let ask = false;
    if (needSwitch && target) {
      lines.push(`Switch to the vault "${clip(target.name)}"`);
      ask ||= plan.allowSwitch !== true;
    }

    const file = plan.file ? withExt(plan.file) : undefined;
    const create = plan.path ? withExt(plan.path) : undefined;
    if (plan.action === "cmd") {
      const id = plan.id ?? "";
      const title = deps.commandTitle(id);
      if (title === null) {
        return fail("NOT_FOUND", `Unknown command ${clip(id)}`, { id });
      }
      lines.push(`Run the command "${clip(title)}" (${clip(id)})`);
      ask ||= plan.allowed !== true;
    }
    if (plan.action === "new" && create) {
      // An existing drawing is only opened: no prompt for that.
      if (!needSwitch && (await openIfExists(create, false))) {
        return { status: "done" };
      }
      lines.push(`Create the drawing "${clip(create)}"`);
      ask ||= plan.allowed !== true;
    }

    const exec = async (): Promise<void> => {
      if (needSwitch && target) {
        const want = trimSlash(target.path);
        await deps.call("vault.open", { path: target.path });
        if (
          !(await waitFor(() => trimSlash(deps.vault()?.path ?? "") === want))
        ) {
          throw new ControlError("TIMEOUT", "The vault did not open in time");
        }
      }
      switch (plan.action) {
        case "open":
          if (file) {
            await deps.call("file.open", { path: file, newTab: !!plan.newTab });
          }
          return;
        case "search":
          deps.openSearch(plan.query ?? "");
          return;
        case "new":
          // Probed just now unless the user was asked (then re-check: it may exist by now).
          if (
            create &&
            (ask || needSwitch) &&
            (await openIfExists(create, false))
          ) {
            return;
          }
          if (create) {
            await deps.call("file.create", { path: create });
            await deps.call("file.open", { path: create, newTab: false });
          }
          return;
        case "cmd":
          await deps.call("command.run", { id: plan.id });
      }
    };
    const report = (e: unknown) =>
      deps.notify(e instanceof Error ? e.message : String(e), "error");

    if (!ask) {
      try {
        await exec();
      } catch (e) {
        report(e);
        throw e;
      }
      return { status: "done" };
    }
    const only = lines.length === 1 ? plan.action : "mixed";
    const wording: Record<string, [string, string]> = {
      new: ["Create drawing?", "Create"],
      cmd: ["Run command?", "Run"],
      open: ["Switch vault?", "Switch"],
      search: ["Switch vault?", "Switch"],
      mixed: ["Open link?", "Continue"],
    };
    const [title, confirmLabel] = wording[only];
    deps.ask({
      title,
      message: "A link from outside wants to:",
      details: lines,
      confirmLabel,
      onConfirm: () => void exec().catch(report),
    });
    return { status: "asking" };
  }

  return { run };
}
