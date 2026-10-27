/**
 * Static checks of `plugin.toml` text. The Rust app (`manifest.rs`) is the authority;
 * the corpus in `sdk/api/test/manifests` keeps the two in step.
 */
import { isSemver } from "./semver.mjs";
import { parseToml, TomlError } from "./toml.mjs";

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const SUPPORTED_API = 0;
const MAX_COMMANDS = 200;
const MAX_PANELS = 20;
const MAX_SETTINGS = 100;
const MAX_TITLE = 200;
const MAX_TEXT = 1000;
const MAX_PATH = 260;
const MAX_PERMISSIONS = 8;
const MAX_IMPORTERS = 8;
const MAX_IMPORTER_EXTENSIONS = 8;
const MAX_EXTENSION = 32;
/** `onDrop:<ext>` is an activation event only when an importer declares `<ext>`. */
const ON_DROP = "onDrop:";
/**
 * Extensions the app handles itself; no importer may claim them. Same list as `RESERVED_EXTENSIONS`
 * in `manifest.rs` and `not.enum` of `definitions.importer` in `plugin.schema.json`.
 */
export const RESERVED_EXTENSIONS = [
  "excalidraw",
  "excalidrawlib",
  "json",
  "pdf",
  "jpeg",
  "svg",
  "png",
  "jpg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "jfif",
  "excalidraw.png",
  "excalidraw.svg",
];
const IMPORTER_KEYS = new Set(["id", "title", "extensions"]);
const MAX_STATUS_ITEMS = 8;
const MAX_VIEWS = 8;
const NOTE_EXTENSIONS = ["md", "markdown", "excalidraw.md"];
const STATUS_KEYS = new Set(["id", "title", "align", "priority", "command"]);
const VIEW_KEYS = new Set(["id", "title", "extensions"]);
/** What a plugin may declare. */
export const PERMISSIONS = ["vault.read", "vault.write", "folders.import"];
/** Kept for later API revisions; an app that knows them as reserved refuses a manifest that uses one. */
const RESERVED_PERMISSIONS = ["net", "secret", "control"];

export const TOP_KEYS = new Set([
  "id",
  "name",
  "version",
  "api",
  "min_app",
  "main",
  "description",
  "author",
  "activation",
  "permissions",
  "data_key",
  "contributes",
  "dev",
]);
const COMMAND_KEYS = new Set(["id", "title", "keys", "when", "palette"]);
const PANEL_KEYS = new Set(["id", "title", "icon", "group"]);

/** Same rule as the app's manifest.rs `is_valid_data_key`. @param {unknown} s */
const isValidDataKey = (s) =>
  typeof s === "string" &&
  s.length <= 64 &&
  /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/.test(s);
/** `^[a-z0-9][a-z0-9-]{1,38}$` @param {string} s */
export const isValidPluginId = (s) => /^[a-z0-9][a-z0-9-]{1,38}$/.test(s);
/** `^[A-Za-z][A-Za-z0-9_-]{0,63}$` @param {string} s */
const isValidShortId = (s) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s);

/**
 * A relative `/`-separated path with no `..`, `.`, empty segments, backslash, NUL,
 * drive colon or leading `/`.
 * @param {string} p
 */
export function isSafeRelPath(p) {
  return (
    p.length > 0 &&
    Buffer.byteLength(p) <= MAX_PATH &&
    !/[\\\0:]/.test(p) &&
    p.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
}

const chars = (s) => [...s].length;
/** `^[a-z0-9]+(\.[a-z0-9]+)*$`, at most 32 bytes @param {string} e */
const isValidExtension = (e) =>
  Buffer.byteLength(e) <= MAX_EXTENSION && /^[a-z0-9]+(\.[a-z0-9]+)*$/.test(e);
const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const show = (v) => (typeof v === "string" ? `'${v}'` : JSON.stringify(v));

/**
 * @typedef {{ code: string, message: string, file: string }} Finding
 * @param {string} text the text of plugin.toml
 * @param {string} [file] the name used in findings
 * @returns {{ errors: Finding[], warnings: Finding[] }}
 */
export function validateManifestText(text, file = "plugin.toml") {
  /** @type {Finding[]} */
  const errors = [];
  /** @type {Finding[]} */
  const warnings = [];
  /** @param {string} code @param {string} message */
  const err = (code, message) => errors.push({ code, message, file });

  if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) {
    err("manifest-too-large", "plugin.toml is larger than 64 KB");
    return { errors, warnings };
  }
  let doc;
  try {
    doc = parseToml(text);
  } catch (e) {
    if (!(e instanceof TomlError)) {
      throw e;
    }
    err("toml-parse", `plugin.toml is not valid TOML (${e.message})`);
    return { errors, warnings };
  }
  // Top-level tables named x-* belong to tools and are ignored, like the app does.
  for (const k of Object.keys(doc)) {
    if (k.startsWith("x-") && isTable(doc[k])) {
      delete doc[k];
    }
  }

  for (const k of Object.keys(doc)) {
    if (!TOP_KEYS.has(k)) {
      err("unknown-key", `Unknown key '${k}' in plugin.toml`);
    }
  }
  for (const k of ["id", "name", "version", "api", "main"]) {
    if (!(k in doc)) {
      err("missing-key", `Missing required key '${k}'`);
    }
  }

  if ("id" in doc) {
    if (typeof doc.id !== "string" || !isValidPluginId(doc.id)) {
      err(
        "id-invalid",
        `Plugin id ${show(
          doc.id,
        )} is invalid (a-z, 0-9 and -, 2 to 39 characters, not starting with -)`,
      );
    }
  }
  if ("name" in doc) {
    if (
      typeof doc.name !== "string" ||
      doc.name.trim() === "" ||
      chars(doc.name) > MAX_TITLE
    ) {
      err("name-invalid", `name must be 1 to ${MAX_TITLE} characters`);
    }
  }
  if ("version" in doc) {
    if (typeof doc.version !== "string" || !isSemver(doc.version)) {
      err(
        "version-invalid",
        `version ${show(
          doc.version,
        )} is not a semantic version (for example 1.0.0)`,
      );
    }
  }
  if ("min_app" in doc) {
    if (typeof doc.min_app !== "string" || !isSemver(doc.min_app)) {
      err(
        "min-app-invalid",
        `min_app ${show(
          doc.min_app,
        )} is not a semantic version (for example 0.1.0)`,
      );
    }
  }
  if ("main" in doc) {
    if (typeof doc.main !== "string" || !isSafeRelPath(doc.main)) {
      err(
        "main-path-invalid",
        `main ${show(
          doc.main,
        )} must be a relative path inside the plugin folder`,
      );
    }
  }
  if ("api" in doc) {
    if (doc.api !== SUPPORTED_API) {
      err(
        "api-unsupported",
        `Plugin API ${show(
          doc.api,
        )} is not supported (this version of the app implements ${SUPPORTED_API})`,
      );
    }
  }
  for (const k of ["description", "author"]) {
    if (k in doc) {
      if (typeof doc[k] !== "string" || chars(doc[k]) > MAX_TEXT) {
        err(
          "text-invalid",
          `${k} must be text of at most ${MAX_TEXT} characters`,
        );
      }
    }
  }
  if ("activation" in doc) {
    if (!isStringArray(doc.activation)) {
      err("activation-unknown", "activation must be a list of event names");
    } else {
      const declared = declaredExtensions(doc.contributes);
      for (const a of doc.activation) {
        const covered =
          a.startsWith(ON_DROP) && declared.has(a.slice(ON_DROP.length));
        if (a !== "onStartupFinished" && !covered) {
          err(
            "activation-unknown",
            `Unknown activation event '${a}' (onStartupFinished, or onDrop:<ext> for an extension an importer declares)`,
          );
        }
      }
    }
  }
  if ("permissions" in doc) {
    checkPermissions(doc.permissions, err);
  }
  if ("data_key" in doc) {
    const k = doc.data_key;
    if (!isValidDataKey(k)) {
      err(
        "data-key-invalid",
        "data_key must be lower case letters, digits, _ and -, parts joined by '.', at most 64 characters",
      );
    } else if (
      (k === "plugins" || k.startsWith("plugins.")) &&
      k !== `plugins.${doc.id}`
    ) {
      err(
        "data-key-reserved",
        `data_key '${k}' belongs to another plugin: keys under 'plugins.' must be 'plugins.${doc.id}'`,
      );
    }
  }
  if ("dev" in doc) {
    if (typeof doc.dev !== "boolean") {
      err("text-invalid", "dev must be true or false");
    } else if (doc.dev) {
      err(
        "dev-true",
        "A packaged plugin must not set dev = true; `vaultdraw-plugin dev` adds it to the installed copy",
      );
    }
  }
  if ("contributes" in doc) {
    checkContributes(doc.contributes, err);
  }
  return { errors, warnings };
}

/** Extensions declared by well-formed importers (the rest is reported by `checkImporters`). @param {unknown} c */
function declaredExtensions(c) {
  const out = new Set();
  const list = isTable(c) && Array.isArray(c.importers) ? c.importers : [];
  for (const x of list) {
    if (isTable(x) && isStringArray(x.extensions)) {
      x.extensions.forEach((e) => out.add(e));
    }
  }
  return out;
}

/**
 * @param {Record<string, any>[]} importers
 * @param {(code: string, message: string) => void} err
 */
function checkImporters(importers, err) {
  const seen = new Set();
  for (const x of importers) {
    // id, title and unknown keys are checked with the other contributions.
    if (!("extensions" in x)) {
      err("missing-key", "An importer is missing 'extensions'");
      continue;
    }
    if (
      !isStringArray(x.extensions) ||
      x.extensions.length < 1 ||
      x.extensions.length > MAX_IMPORTER_EXTENSIONS
    ) {
      err(
        "contribution-invalid",
        `Importer ${show(
          x.id,
        )} needs 1 to ${MAX_IMPORTER_EXTENSIONS} extensions`,
      );
      continue;
    }
    for (const e of x.extensions) {
      if (!isValidExtension(e)) {
        err(
          "importer-extension-invalid",
          `Extension '${e}' is invalid (lower case letters and digits, dots between parts, at most ${MAX_EXTENSION} bytes, no leading dot)`,
        );
      } else if (RESERVED_EXTENSIONS.includes(e)) {
        err(
          "importer-extension-reserved",
          `Extension '${e}' is handled by the app`,
        );
      } else if (seen.has(e)) {
        err(
          "importer-extension-invalid",
          `Duplicate importer extension '${e}'`,
        );
      } else {
        seen.add(e);
      }
    }
  }
}

/**
 * @param {unknown} list
 * @param {(code: string, message: string) => void} err
 */
function checkPermissions(list, err) {
  if (!isStringArray(list)) {
    err("permission-invalid", "permissions must be a list of permission names");
    return;
  }
  if (list.length > MAX_PERMISSIONS) {
    err("permission-too-many", `Too many permissions (max ${MAX_PERMISSIONS})`);
    return;
  }
  const seen = new Set();
  for (const p of list) {
    if (RESERVED_PERMISSIONS.includes(p)) {
      err(
        "permission-reserved",
        `Permission '${p}' is reserved and cannot be used yet`,
      );
    } else if (!PERMISSIONS.includes(p)) {
      err(
        "permission-unknown",
        `Unknown permission '${p}' (known: ${PERMISSIONS.join(", ")})`,
      );
    } else if (seen.has(p)) {
      err("permission-duplicate", `Duplicate permission '${p}'`);
    } else {
      seen.add(p);
    }
  }
}

/**
 * @param {Record<string, any>[]} views
 * @param {(code: string, message: string) => void} err
 */
function checkViews(views, err) {
  const seen = new Set();
  for (const x of views) {
    if (!("extensions" in x)) {
      err("missing-key", "A view is missing 'extensions'");
      continue;
    }
    if (
      !isStringArray(x.extensions) ||
      x.extensions.length < 1 ||
      x.extensions.length > MAX_IMPORTER_EXTENSIONS
    ) {
      err(
        "contribution-invalid",
        `View ${show(x.id)} needs 1 to ${MAX_IMPORTER_EXTENSIONS} extensions`,
      );
      continue;
    }
    for (const e of x.extensions) {
      if (!isValidExtension(e)) {
        err(
          "view-extension-invalid",
          `Extension '${e}' is invalid (lower case letters and digits, dots between parts, at most ${MAX_EXTENSION} bytes, no leading dot)`,
        );
      } else if (NOTE_EXTENSIONS.includes(e) || !e.endsWith(".md")) {
        err(
          "view-extension-invalid",
          `View extension '${e}' must end in '.md' with a name before it, like 'kanban.md' (only notes open in views for now)`,
        );
      } else if (seen.has(e)) {
        err("view-extension-invalid", `Duplicate view extension '${e}'`);
      } else {
        seen.add(e);
      }
    }
  }
}

/**
 * @param {Record<string, any>[]} items
 * @param {Record<string, any>[]} commands
 * @param {(code: string, message: string) => void} err
 */
function checkStatusBar(items, commands, err) {
  const ids = new Set(commands.map((c) => c.id));
  for (const x of items) {
    if ("align" in x && x.align !== "left" && x.align !== "right") {
      err(
        "contribution-invalid",
        'status bar item align must be "left" or "right"',
      );
    }
    if ("priority" in x && !Number.isInteger(x.priority)) {
      err(
        "contribution-invalid",
        "status bar item priority must be an integer",
      );
    }
    if ("command" in x && !ids.has(x.command)) {
      err(
        "status-command-unknown",
        `Status bar item ${show(x.id)} names command ${show(
          x.command,
        )}, which the plugin does not declare`,
      );
    }
  }
}

/**
 * @param {unknown} c
 * @param {(code: string, message: string) => void} err
 */
function checkContributes(c, err) {
  if (!isTable(c)) {
    err("contribution-invalid", "contributes must be a table");
    return;
  }
  for (const k of Object.keys(c)) {
    if (
      ![
        "commands",
        "panels",
        "settings",
        "importers",
        "status_bar",
        "views",
      ].includes(k)
    ) {
      err(
        "unknown-key",
        `Unknown key 'contributes.${k}' (use commands, panels, settings, importers, status_bar or views)`,
      );
    }
  }
  /** @param {string} k */
  const list = (k) => {
    const v = c[k];
    if (v === undefined) {
      return [];
    }
    if (!Array.isArray(v) || !v.every(isTable)) {
      err(
        "contribution-invalid",
        `contributes.${k} must be a list of tables ([[contributes.${k}]])`,
      );
      return [];
    }
    return v;
  };
  const commands = list("commands");
  const panels = list("panels");
  const settings = list("settings");
  const importers = list("importers");
  const statusBar = list("status_bar");
  const views = list("views");
  if (views.length > MAX_VIEWS) {
    err("too-many", `Too many views (max ${MAX_VIEWS})`);
  }
  if (statusBar.length > MAX_STATUS_ITEMS) {
    err("too-many", `Too many status bar items (max ${MAX_STATUS_ITEMS})`);
  }
  if (
    commands.length > MAX_COMMANDS ||
    panels.length > MAX_PANELS ||
    settings.length > MAX_SETTINGS
  ) {
    err(
      "too-many",
      `Too many contributions (max ${MAX_COMMANDS} commands, ${MAX_PANELS} panels, ${MAX_SETTINGS} settings)`,
    );
  }
  if (importers.length > MAX_IMPORTERS) {
    err("too-many", `Too many importers (max ${MAX_IMPORTERS})`);
  }
  for (const [what, items, known] of /** @type {const} */ ([
    ["command", commands, COMMAND_KEYS],
    ["panel", panels, PANEL_KEYS],
    ["importer", importers, IMPORTER_KEYS],
    ["status bar item", statusBar, STATUS_KEYS],
    ["view", views, VIEW_KEYS],
  ])) {
    const seen = new Set();
    for (const x of items) {
      for (const k of Object.keys(x)) {
        if (!known.has(k)) {
          err("unknown-key", `Unknown key '${k}' in a ${what}`);
        }
      }
      for (const k of ["id", "title"]) {
        if (!(k in x)) {
          err("missing-key", `A ${what} is missing '${k}'`);
        }
      }
      if ("id" in x) {
        if (typeof x.id !== "string" || !isValidShortId(x.id)) {
          err(
            "contribution-id-invalid",
            `${what} id ${show(
              x.id,
            )} is invalid (letters, digits, - and _, starting with a letter)`,
          );
        } else if (seen.has(x.id)) {
          err("contribution-duplicate", `Duplicate ${what} id '${x.id}'`);
        } else {
          seen.add(x.id);
        }
      }
      if (
        "title" in x &&
        (typeof x.title !== "string" ||
          x.title.trim() === "" ||
          chars(x.title) > MAX_TITLE)
      ) {
        err(
          "title-invalid",
          `${what} title must be 1 to ${MAX_TITLE} characters`,
        );
      }
      if ("keys" in x && !isStringArray(x.keys)) {
        err("contribution-invalid", `${what} keys must be a list of strings`);
      }
      if ("when" in x && !isStringArray(x.when)) {
        err("contribution-invalid", `${what} when must be a list of strings`);
      }
      if ("palette" in x && typeof x.palette !== "boolean") {
        err("contribution-invalid", `${what} palette must be true or false`);
      }
      if ("icon" in x && typeof x.icon !== "string") {
        err("contribution-invalid", `${what} icon must be a string`);
      }
      if ("group" in x && x.group !== "top" && x.group !== "bottom") {
        err("contribution-invalid", `${what} group must be "top" or "bottom"`);
      }
    }
  }
  checkImporters(importers, err);
  checkStatusBar(statusBar, commands, err);
  checkViews(views, err);
  for (const s of settings) {
    const field = (k) => typeof s[k] === "string" && s[k] !== "";
    if (!field("key") || !field("type")) {
      err("setting-invalid", "Every setting needs a string 'key' and 'type'");
    }
  }
}
