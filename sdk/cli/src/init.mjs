/** `vaultdraw-plugin init <id>`: a new plugin folder from an example. */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EnvError } from "./dirs.mjs";
import { listFiles } from "./files.mjs";
import { isValidPluginId } from "./manifest.mjs";

export const EXAMPLES = ["hello-command", "focus-timer", "stamp"];
/** The `sdk/` folder, next to this command. */
const sdkRoot = () => fileURLToPath(new URL("../../", import.meta.url));

/** `my-cool-plugin` becomes `My Cool Plugin`. @param {string} id */
export const titleCase = (id) =>
  id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Rewrites the top-level keys of an example's plugin.toml. Only lines before the first
 * table are touched. The author line is removed.
 * @param {string} text
 * @param {string} id
 */
export function rewriteManifest(text, id) {
  const replacements = {
    id: `id = "${id}"`,
    name: `name = "${titleCase(id)}"`,
    version: 'version = "0.1.0"',
    description: 'description = "A Vaultdraw plugin."',
  };
  const lines = text.split("\n");
  let top = true;
  const out = [];
  for (const line of lines) {
    if (top && /^\s*\[/.test(line)) {
      top = false;
    }
    const key = top ? /^([A-Za-z_]+)\s*=/.exec(line)?.[1] : undefined;
    if (key === "author") {
      continue;
    }
    out.push(
      key && key in replacements
        ? replacements[/** @type {keyof typeof replacements} */ (key)]
        : line,
    );
  }
  return out.join("\n");
}

/**
 * `api-surface.d.ts` is the flattened public surface with relative imports between its
 * parts. Inside `declare module` those are not allowed (and not needed: everything is in
 * one scope), so they are dropped.
 * @param {string} surface
 */
export function wrapApiTypes(surface) {
  const REL =
    /^(?:import|export)(?:\s+type)?\s*(?:\*|\{[^}]*\}|\w+)(?:\s+as\s+\w+)?\s*from\s*"\.\/[^"]*";?[ \t]*$/gm;
  const body = surface
    .replace(REL, "")
    .replace(/^\/\/ [\w.-]+\.ts$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const indented = body
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
  return [
    "// Types of the Vaultdraw plugin API, for editor completion. Copied by `vaultdraw-plugin init`.",
    "// There is nothing to install: this file declares the module in place.",
    'declare module "@vaultdraw/api" {',
    indented,
    "}",
    "",
  ].join("\n");
}

const JSCONFIG = `{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": [],
    "jsx": "react",
    "skipLibCheck": true
  },
  "include": ["*.js", "*.d.ts"]
}
`;

/** @param {string} id @param {string} name */
const readme = (id, name) => `# ${name}

A Vaultdraw plugin.

## Develop

1. \`vaultdraw-plugin dev .\` copies this folder into your plugins folder and keeps it up to date on every save.
2. In Vaultdraw, press Cmd+P, run "Plugins: Reload plugin list", then enable the plugin in Settings, Plugins.
3. \`vaultdraw-plugin check .\` runs the static checks (also useful in CI).

The plugin id is \`${id}\`. The manifest is \`plugin.toml\`; the code is \`main.js\`.
`;

/**
 * @param {string} id
 * @param {{ example?: string, dir?: string }} opts
 * @param {(s: string) => void} out
 */
export function runInit(id, opts, out) {
  const example = opts.example ?? "hello-command";
  if (!EXAMPLES.includes(example)) {
    throw new EnvError(
      `Unknown example '${example}'. Choose one of: ${EXAMPLES.join(", ")}`,
    );
  }
  if (!isValidPluginId(id)) {
    throw new EnvError(
      `'${id}' is not a valid plugin id. Use a-z, 0-9 and -, 2 to 39 characters, not starting with -`,
    );
  }
  const exampleDir = path.join(sdkRoot(), "examples", example);
  const surfaceFile = path.join(sdkRoot(), "api", "etc", "api-surface.d.ts");
  if (!existsSync(exampleDir) || !existsSync(surfaceFile)) {
    throw new EnvError(
      "The SDK examples and types were not found next to this command",
    );
  }
  const parent = path.resolve(opts.dir ?? process.cwd());
  const target = path.join(parent, id);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new EnvError(`The folder ${target} already exists and is not empty`);
  }
  if (!existsSync(parent)) {
    throw new EnvError(`Folder not found: ${parent}`);
  }

  const files = listFiles(exampleDir).filter((f) => f !== "plugin.toml");
  const mainRel = "main.js";
  mkdirSync(target, { recursive: true });
  /** @param {string} rel @param {string | Buffer} data */
  const put = (rel, data) => {
    const f = path.join(target, ...rel.split("/"));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, data);
  };
  for (const f of files.filter((f) => f !== mainRel)) {
    put(f, readFileSync(path.join(exampleDir, ...f.split("/"))));
  }
  put("vaultdraw-api.d.ts", wrapApiTypes(readFileSync(surfaceFile, "utf8")));
  put("jsconfig.json", JSCONFIG);
  put("README.md", readme(id, titleCase(id)));
  put(
    "plugin.toml",
    rewriteManifest(
      readFileSync(path.join(exampleDir, "plugin.toml"), "utf8"),
      id,
    ),
  );
  put(mainRel, readFileSync(path.join(exampleDir, mainRel)));

  out(`Created ${target} from the ${example} example.`);
  out("");
  out("Next steps:");
  out(`  cd ${parent === process.cwd() ? id : target}`);
  out("  vaultdraw-plugin dev .");
  return 0;
}
