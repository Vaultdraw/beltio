/**
 * The child process of `check --activate`: loads the plugin's main file, runs `activate`
 * against a dry context and prints one JSON line with what it saw. Started by `activate.mjs`
 * (never by hand) with the job as the first argument.
 *
 * The dry context follows the app's host rules for what a plugin may bind: only the commands
 * and panels declared in plugin.toml. Anything that needs the real app (running other
 * commands, the scene, settings writes) is reported as a warning and does nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The event names of `AppEventMap` (a test keeps this list equal to sdk/api/src/events.ts). */
const EVENT_NAMES = [
  "vault.opened",
  "drawing.opened",
  "drawing.saved",
  "drawing.renamed",
  "drawing.deleted",
];

const DEACTIVATE_TIMEOUT_MS = 2000;

/** Named exports each shared module always has, so stubs satisfy common imports. */
const KNOWN_NAMES = {
  "@vaultdraw/api": ["definePlugin"],
  "react/jsx-runtime": ["jsx", "jsxs", "Fragment"],
};

const NAMED_IMPORT = /import\s*(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"'\n]+)["']/g;

/** @param {string} root @returns {string[]} the JavaScript files below `root` (bounded) */
function jsFiles(root) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= 400 || e.name === "node_modules" || e.name.startsWith(".")) {
        continue;
      }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.m?js$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Named imports of each shared specifier across the plugin's files.
 * @param {string} root @param {string[]} shared
 * @returns {Record<string, Set<string>>}
 */
function importedNames(root, shared) {
  /** @type {Record<string, Set<string>>} */
  const names = Object.fromEntries(
    shared.map((s) => [s, new Set(KNOWN_NAMES[s] ?? [])]),
  );
  for (const file of jsFiles(root)) {
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(NAMED_IMPORT)) {
      if (!names[m[2]]) {
        continue;
      }
      for (const part of m[1].split(",")) {
        const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(n) && n !== "default") {
          names[m[2]].add(n);
        }
      }
    }
  }
  return names;
}

/**
 * Module source for a shared specifier: every export is a function that does nothing
 * (`definePlugin` returns its argument).
 * @param {string} spec @param {Set<string>} names
 */
function stubSource(spec, names) {
  const lines = [
    "const noop = () => undefined;",
    "export default new Proxy(noop, { get: () => noop });",
  ];
  for (const n of names) {
    lines.push(
      n === "definePlugin"
        ? "export const definePlugin = (p) => p;"
        : `export const ${n} = noop;`,
    );
  }
  return lines.join("\n");
}

const text = (e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {{ root: string, main: string, shared: string[], manifest: any }} job
 */
async function run(job) {
  const { root, main, shared, manifest } = job;
  const commands = new Set((manifest.contributes?.commands ?? []).map((c) => c.id));
  const panels = new Set((manifest.contributes?.panels ?? []).map((p) => p.id));
  const settings = new Map(
    (manifest.contributes?.settings ?? []).map((s) => [s.key, s.default]),
  );
  /** @type {{ level: "error" | "warning", code: string, message: string }[]} */
  const findings = [];
  const add = (level, code, message) => {
    if (!findings.some((f) => f.code === code && f.message === message)) {
      findings.push({ level, code, message });
    }
  };
  const boundCommands = new Set();
  const boundPanels = new Set();
  /** @type {{ level: string, text: string }[]} */
  const logs = [];
  const subscriptions = [];
  const timers = new Set();
  const disposable = (fn) => {
    let done = false;
    const d = {
      dispose() {
        if (!done) {
          done = true;
          fn();
        }
      },
    };
    subscriptions.push(d);
    return d;
  };
  const unsupported = (what) => {
    add(
      "warning",
      "activate-unsupported",
      `${what} needs the running app, so check --activate skipped it`,
    );
  };

  const rootUrl = pathToFileURL(root + path.sep).href;
  const names = importedNames(root, shared);
  registerHooks({
    resolve(specifier, context, next) {
      if (shared.includes(specifier)) {
        return { url: `vd-shared:${specifier}`, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith("vd-shared:")) {
        const spec = url.slice("vd-shared:".length);
        return {
          format: "module",
          source: stubSource(spec, names[spec] ?? new Set()),
          shortCircuit: true,
        };
      }
      if (url.startsWith(rootUrl) && /\.m?js$/.test(url)) {
        // The app loads every plugin file as an ES module, whatever package.json says.
        return {
          format: "module",
          source: readFileSync(new URL(url)),
          shortCircuit: true,
        };
      }
      return next(url, context);
    },
  });

  const refuse = (kind, short) => {
    add(
      "error",
      `activate-undeclared-${kind}`,
      `activate() binds the ${kind} '${short}', which plugin.toml does not declare; the app refuses it. Add it under [[contributes.${kind}s]] or remove the call`,
    );
    return { dispose() {} };
  };
  const logger = (level) => (...a) => {
    logs.push({ level, text: a.map(text).join(" ") });
  };
  const timer = (set, clear) => (fn, ms) => {
    const h = set(() => {
      try {
        fn();
      } catch (e) {
        add("warning", "activate-timer-error", `A timer callback threw: ${text(e)}`);
      }
    }, ms);
    h?.unref?.();
    timers.add(h);
    return disposable(() => {
      clear(h);
      timers.delete(h);
    });
  };
  const deep = (path) =>
    new Proxy(() => undefined, {
      get: (_t, k) => (typeof k === "symbol" ? undefined : deep(`${path}.${k}`)),
      apply: () => {
        unsupported(`ctx.${path}()`);
        return undefined;
      },
    });

  const ctx = {
    manifest: { id: manifest.id, version: manifest.version ?? "0.0.0", dir: root },
    commands: {
      register(short, handler) {
        if (typeof short !== "string" || typeof handler !== "function") {
          add("error", "activate-bad-call", "ctx.commands.register needs a command id and a function");
          return { dispose() {} };
        }
        if (!commands.has(short)) {
          return refuse("command", short);
        }
        boundCommands.add(short);
        return disposable(() => boundCommands.delete(short));
      },
      execute() {
        unsupported("ctx.commands.execute");
        return Promise.resolve();
      },
    },
    panels: {
      register(short, component) {
        if (typeof short !== "string" || component === undefined) {
          add("error", "activate-bad-call", "ctx.panels.register needs a panel id and a component");
          return { dispose() {} };
        }
        if (!panels.has(short)) {
          return refuse("panel", short);
        }
        boundPanels.add(short);
        return disposable(() => boundPanels.delete(short));
      },
      open() {
        unsupported("ctx.panels.open");
      },
      close() {},
    },
    settings: {
      get: (key) => settings.get(key),
      async set() {
        unsupported("ctx.settings.set");
      },
      onChange: () => disposable(() => {}),
    },
    ui: { toast: () => {} },
    log: {
      debug: logger("debug"),
      info: logger("info"),
      warn: logger("warn"),
      error: logger("error"),
    },
    scene: deep("scene"),
    events: {
      on(name) {
        if (!EVENT_NAMES.includes(name)) {
          add(
            "error",
            "activate-unknown-event",
            `ctx.events.on('${String(name)}') names an event the app does not have; known events: ${EVENT_NAMES.join(", ")}`,
          );
        }
        return disposable(() => {});
      },
    },
    subscriptions,
    setTimeout: timer(globalThis.setTimeout, globalThis.clearTimeout),
    setInterval: timer(globalThis.setInterval, globalThis.clearInterval),
  };

  const started = performance.now();
  /** @type {any} */
  let plugin;
  try {
    const mod = await import(pathToFileURL(path.join(root, ...main.split("/"))).href);
    plugin = mod.default;
  } catch (e) {
    add("error", "activate-load-failed", `${main} failed to load: ${text(e)}`);
    return { findings, commands: [], panels: [], logs, ms: 0 };
  }
  if (!plugin || typeof plugin.activate !== "function") {
    add(
      "error",
      "activate-no-default",
      `${main} must export a plugin as its default export, with an activate(ctx) function`,
    );
    return { findings, commands: [], panels: [], logs, ms: 0 };
  }
  try {
    await plugin.activate(ctx);
  } catch (e) {
    add("error", "activate-threw", `activate() threw: ${text(e)}`);
  }
  const ms = Math.round(performance.now() - started);
  for (const id of commands) {
    if (!boundCommands.has(id)) {
      add(
        "error",
        "activate-unbound-command",
        `The command '${id}' is declared in plugin.toml but activate() never binds it; running it fails in the app. Add ctx.commands.register('${id}', ...)`,
      );
    }
  }
  for (const id of panels) {
    if (!boundPanels.has(id)) {
      add(
        "error",
        "activate-unbound-panel",
        `The panel '${id}' is declared in plugin.toml but activate() never registers it. Add ctx.panels.register('${id}', ...)`,
      );
    }
  }
  const result = {
    findings,
    commands: [...boundCommands],
    panels: [...boundPanels],
    logs,
    ms,
  };
  // Leave the plugin the way the app does: deactivate (2 s), then dispose in reverse order.
  if (typeof plugin.deactivate === "function") {
    try {
      await Promise.race([
        Promise.resolve(plugin.deactivate()),
        new Promise((resolve) => setTimeout(resolve, DEACTIVATE_TIMEOUT_MS).unref()),
      ]);
    } catch (e) {
      add("warning", "deactivate-threw", `deactivate() threw: ${text(e)}`);
    }
  }
  for (const d of [...subscriptions].reverse()) {
    try {
      d.dispose();
    } catch (e) {
      add("warning", "dispose-threw", `A subscription's dispose() threw: ${text(e)}`);
    }
  }
  return result;
}

const job = JSON.parse(process.argv[2]);
let result;
try {
  result = await run(job);
} catch (e) {
  result = {
    findings: [{ level: "error", code: "activate-threw", message: `The dry run failed: ${text(e)}` }],
    commands: [],
    panels: [],
    logs: [],
    ms: 0,
  };
}
process.stdout.write(`\n@@vaultdraw-activate@@${JSON.stringify(result)}\n`);
// A plugin may leave handles open; the result is out, so end now.
process.exit(0);
