#!/usr/bin/env node
/**
 * Writes sdk/api/testing/features.ts: the names `ctx.host.has()` answers true for, each with the
 * API revision that added it, read from the `@since` tags of sdk/api/src.
 * Run: node sdk/api/scripts/gen-features.mjs
 * The test sdk/api/test/features.test.ts fails when the committed file differs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const srcDir = path.join(root, "src");
export const FEATURES_FILE = path.join(root, "testing", "features.ts");

const sinceOf = (node) => {
  const tag = ts.getJSDocTags(node).find((t) => t.tagName.text === "since");
  const text = typeof tag?.comment === "string" ? tag.comment.trim() : "";
  return /^\d+\.\d+\.\d+$/.test(text) ? text : null;
};

/** `{ revision, features }`: name to the revision that added it. */
export function readFeatures() {
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(srcDir, f));
  const program = ts.createProgram(files, {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const inSrc = (decl) =>
    path.dirname(decl.getSourceFile().fileName) === srcDir;
  const features = {};
  const missing = [];
  const add = (name, node) => {
    const since = sinceOf(node);
    if (since === null) {
      missing.push(name);
    } else {
      features[name] = since;
    }
  };

  const plugin = program.getSourceFile(path.join(srcDir, "plugin.ts"));
  const context = plugin.statements.find(
    (s) => ts.isInterfaceDeclaration(s) && s.name.text === "PluginContext",
  );
  for (const member of context.members) {
    const ns = member.name.getText();
    add(ns, member);
    const type =
      ts.isPropertySignature(member) &&
      member.type &&
      checker.getTypeFromTypeNode(member.type);
    const decl = type?.symbol?.declarations?.[0];
    if (!decl || !ts.isInterfaceDeclaration(decl) || !inSrc(decl)) {
      continue;
    }
    for (const prop of type.getProperties()) {
      add(`${ns}.${prop.name}`, prop.declarations[0]);
    }
  }

  const events = program.getSourceFile(path.join(srcDir, "events.ts"));
  const map = events.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === "AppEventMap",
  );
  for (const m of map.type.members) {
    // A member's own @since wins over the one on the type alias.
    add(m.name.text.replace(/^"|"$/g, ""), sinceOf(m) ? m : map);
  }

  if (missing.length > 0) {
    throw new Error(`Missing @since on: ${missing.join(", ")}`);
  }
  const revision = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  return { revision, features };
}

export function generate() {
  const { revision, features } = readFeatures();
  const rows = Object.keys(features)
    .sort()
    // Quote only what needs it, as Prettier writes it.
    .map((k) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      return `  ${key}: ${JSON.stringify(features[k])},`;
    });
  return `// Generated from the @since tags of sdk/api/src by sdk/api/scripts/gen-features.mjs. Do not edit.

/** The API revision of this build (the version of sdk/api/package.json). */
export const API_REVISION = ${JSON.stringify(revision)};

/** Feature name to the revision that added it. \`ctx.host.has(name)\` is true for these. */
export const FEATURES: Readonly<Record<string, string>> = {
${rows.join("\n")}
};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(FEATURES_FILE), { recursive: true });
  fs.writeFileSync(FEATURES_FILE, generate());
  process.stdout.write(
    `wrote ${path.relative(process.cwd(), FEATURES_FILE)}\n`,
  );
}
