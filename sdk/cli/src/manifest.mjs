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
/** What a plugin may declare. */
export const PERMISSIONS = ["vault.read", "vault.write"];
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
  "contributes",
  "dev",
]);
const COMMAND_KEYS = new Set(["id", "title", "keys", "when", "palette"]);
const PANEL_KEYS = new Set(["id", "title", "icon", "group"]);

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
      for (const a of doc.activation) {
        if (a !== "onStartupFinished") {
          err(
            "activation-unknown",
            `Unknown activation event '${a}' (only onStartupFinished exists)`,
          );
        }
      }
    }
  }
  if ("permissions" in doc) {
    checkPermissions(doc.permissions, err);
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
 * @param {unknown} c
 * @param {(code: string, message: string) => void} err
 */
function checkContributes(c, err) {
  if (!isTable(c)) {
    err("contribution-invalid", "contributes must be a table");
    return;
  }
  for (const k of Object.keys(c)) {
    if (!["commands", "panels", "settings"].includes(k)) {
      err(
        "unknown-key",
        `Unknown key 'contributes.${k}' (use commands, panels or settings)`,
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
  for (const [what, items, known] of /** @type {const} */ ([
    ["command", commands, COMMAND_KEYS],
    ["panel", panels, PANEL_KEYS],
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
  for (const s of settings) {
    const field = (k) => typeof s[k] === "string" && s[k] !== "";
    if (!field("key") || !field("type")) {
      err("setting-invalid", "Every setting needs a string 'key' and 'type'");
    }
  }
}
