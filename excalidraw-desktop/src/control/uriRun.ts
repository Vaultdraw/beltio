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

export type UriAction =
  | "focus"
  | "open"
  | "search"
  | "new"
  | "cmd"
  | "notice"
  | "file";

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
  /** `file` only: what the system handed over. */
  kind?: "drawing" | "library";
}

export interface AskSpec {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  /** Further buttons (the dialog always has Cancel and the confirm button). */
  alternatives?: { label: string; run: () => void }[];
  onConfirm: () => void;
}

export interface UriDeps {
  /** A window method (the table `createWindowMethods` returns plus command.run). */
  call: (method: string, params: unknown) => Promise<unknown>;
  vault: () => { name: string; path: string } | null;
  recentVaults: () => readonly string[];
  /** The command's title, or null when no such command exists. */
  commandTitle: (id: string) => string | null;
  /** The app's own command (not one a plugin registered). */
  isBuiltin: (id: string) => boolean;
  openSearch: (query: string) => void;
  /** Files from the system (see `runFile`). */
  readExternal: (
    path: string,
    kind: "drawing" | "library",
  ) => Promise<{ name: string; json: string }>;
  /** A drawing exists in the open vault. */
  exists: (path: string) => Promise<boolean>;
  /** Merges a library file's items into the personal or the vault library. */
  addLibrary: (json: string, scope: "personal" | "vault") => Promise<void>;
  canAddVaultLibrary: () => boolean;
  ask: (spec: AskSpec) => void;
  notify: (message: string, kind?: "error") => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type UriResult = { status: "done" | "asking" };

/** How long a link waits for the vault to load on a cold start. */
export const VAULT_WAIT_MS = 10_000;
const POLL_MS = 50;
/** Longest text a dialog line shows whole; longer text keeps its start and its end. */
export const SHOWN_CHARS = 400;

/** Middle ellipsis: the end of a path or id (the part that matters) is never cut off. */
export const clip = (s: string): string => {
  if (s.length <= SHOWN_CHARS) {
    return s;
  }
  const head = Math.ceil((SHOWN_CHARS - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (SHOWN_CHARS - 1 - head))}`;
};

const baseName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const trimSlash = (path: string): string => path.replace(/[\\/]+$/, "");

/** Resolves `.` and `..` in an absolute path (text only). */
const normalizeAbs = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      out.pop();
    } else if (part !== "" && part !== ".") {
      out.push(part);
    }
  }
  return `/${out.join("/")}`;
};

/** The path under `root`, or null when `path` is not inside it. */
const insideRoot = (root: string, path: string): string | null => {
  const r = normalizeAbs(root);
  return path.startsWith(`${r === "/" ? "" : r}/`)
    ? path.slice(r === "/" ? 1 : r.length + 1)
    : null;
};

const MAX_COPY_SUFFIX = 100;

/** Items in a library file (`libraryItems`, or the old `library`). */
const libraryCount = (json: string): number => {
  try {
    const data = JSON.parse(json) as {
      libraryItems?: unknown;
      library?: unknown;
    };
    const items = data.libraryItems ?? data.library;
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
};

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
      case "file":
        return runFile(plan);
      case "open":
      case "search":
      case "new":
      case "cmd":
        return act(plan);
      default:
        return fail("INVALID_PARAMS", "Unknown link action");
    }
  }

  const report = (e: unknown) =>
    deps.notify(e instanceof Error ? e.message : String(e), "error");

  /**
   * A file the system opened (Finder, Open With, argv). Inside the open vault it
   * just opens. In another known vault, or outside every vault, it asks; copying
   * into the vault and importing a library never happen unasked, and a copy never
   * replaces a file (a numbered name is used). Returns at once with `asking`.
   */
  async function runFile(plan: UriPlan): Promise<UriResult> {
    const raw = plan.path ?? "";
    if (!raw.startsWith("/")) {
      return fail("INVALID_PARAMS", "The file path must be absolute");
    }
    const path = normalizeAbs(raw);
    const base = baseName(path);
    if (plan.kind === "library") {
      return askLibrary(path);
    }
    await waitFor(() => deps.vault() !== null);
    const open = deps.vault();
    const roots = new Map<string, { name: string; path: string }>();
    for (const p of [open?.path, ...deps.recentVaults()]) {
      if (p) {
        roots.set(trimSlash(p), { name: baseName(p), path: p });
      }
    }
    // The deepest vault that contains the file.
    let home: { name: string; path: string; rel: string } | null = null;
    for (const v of roots.values()) {
      const rel = insideRoot(v.path, path);
      if (
        rel &&
        (!home || normalizeAbs(v.path).length > normalizeAbs(home.path).length)
      ) {
        home = { ...v, rel };
      }
    }
    const openFile = async (rel: string) => {
      try {
        await deps.call("file.open", { path: rel, newTab: false });
      } catch (e) {
        report(e);
        throw e;
      }
    };
    const switchTo = async (root: string) => {
      const want = trimSlash(root);
      await deps.call("vault.open", { path: root });
      if (
        !(await waitFor(() => trimSlash(deps.vault()?.path ?? "") === want))
      ) {
        throw new ControlError("TIMEOUT", "The vault did not open in time");
      }
    };
    if (home && open && trimSlash(open.path) === trimSlash(home.path)) {
      await openFile(home.rel);
      return { status: "done" };
    }
    const startPath = open?.path ?? null;
    if (home) {
      const target = home;
      deps.ask({
        title: "Switch vault?",
        message: "A file from outside is in another vault:",
        details: [`Switch to the vault "${clip(target.name)}"`, clip(path)],
        confirmLabel: "Switch and open",
        onConfirm: () =>
          void switchTo(target.path)
            .then(() => openFile(target.rel))
            .catch(report),
      });
      return { status: "asking" };
    }
    // Outside every vault we know of.
    const dir = path.slice(0, path.length - base.length - 1) || "/";
    const openFolder = () =>
      void switchTo(dir)
        .then(() => openFile(base))
        .catch(report);
    const copyIn = async () => {
      if ((deps.vault()?.path ?? null) !== startPath) {
        throw new ControlError(
          "CONFLICT",
          "The vault changed while the question waited: it was cancelled",
        );
      }
      const file = await deps.readExternal(path, "drawing");
      const scene = JSON.parse(file.json) as unknown;
      const stem = base.replace(/\.excalidraw$/i, "");
      let name = `${stem}.excalidraw`;
      for (let n = 2; await deps.exists(name); n += 1) {
        if (n > MAX_COPY_SUFFIX) {
          throw new ControlError("CONFLICT", `Too many copies of "${stem}"`);
        }
        name = `${stem} ${n}.excalidraw`;
      }
      await deps.call("file.create", { path: name, scene });
      await openFile(name);
      deps.notify(`Copied "${clip(base)}" into the vault as "${clip(name)}"`);
    };
    const spec: AskSpec = {
      title: "Open a file from outside your vaults?",
      message: `"${clip(
        base,
      )}" is not in a vault you use. A drawing is opened from a vault; nothing is changed unless you choose:`,
      details: [clip(path)],
      confirmLabel: open ? "Copy into vault" : "Open its folder as a vault",
      onConfirm: open ? () => void copyIn().catch(report) : openFolder,
      ...(open
        ? {
            alternatives: [
              { label: "Open its folder as a vault", run: openFolder },
            ],
          }
        : {}),
    };
    deps.ask(spec);
    return { status: "asking" };
  }

  async function askLibrary(path: string): Promise<UriResult> {
    let file: { name: string; json: string };
    try {
      file = await deps.readExternal(path, "library");
    } catch (e) {
      report(e);
      throw e;
    }
    const n = libraryCount(file.json);
    const add = (scope: "personal" | "vault") => () =>
      void deps
        .addLibrary(file.json, scope)
        .then(() =>
          deps.notify(
            `Added ${n} item${n === 1 ? "" : "s"} to the ${
              scope === "vault" ? "vault" : "personal"
            } library`,
          ),
        )
        .catch(report);
    deps.ask({
      title: `Add ${n} item${n === 1 ? "" : "s"} to the library?`,
      message: `"${clip(
        file.name,
      )}" is a library file. Its items are merged into a library; nothing is replaced.`,
      details: [clip(path)],
      confirmLabel: "Add to my library",
      onConfirm: add("personal"),
      ...(deps.canAddVaultLibrary()
        ? {
            alternatives: [
              { label: "Add to this vault's library", run: add("vault") },
            ],
          }
        : {}),
    });
    return { status: "asking" };
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
      // Links run only built-in commands, unless the user listed this exact id in uri_allow.
      if (!deps.isBuiltin(id) && plan.allowed !== true) {
        return fail(
          "NOT_PERMITTED",
          `A link can only run built-in commands (${clip(
            id,
          )} comes from a plugin; list it in control.uri_allow to allow it)`,
          { id },
        );
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

    const startPath = deps.vault()?.path ?? null;
    const exec = async (): Promise<void> => {
      // Decided again now: the user may have switched vault while the question waited.
      const nowOpen = deps.vault()?.path ?? null;
      if (!target && nowOpen !== startPath) {
        throw new ControlError(
          "CONFLICT",
          "The vault changed while the link was waiting: it was cancelled",
        );
      }
      const mustSwitch =
        !!target &&
        (nowOpen === null || trimSlash(nowOpen) !== trimSlash(target.path));
      if (mustSwitch && target) {
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
            (ask || mustSwitch) &&
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
