#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `npm create vaultdraw-plugin <id> [--template command|panel|scene | --example <name>]`.
 * Runs `vaultdraw-plugin init` with a TypeScript `command` template unless the caller picks
 * a template or an example. All other arguments pass through.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SPECIFIER = "vaultdraw-plugin/bin/vaultdraw-plugin.mjs";
const SIBLING = new URL("../../cli/bin/vaultdraw-plugin.mjs", import.meta.url);

/** The installed CLI, or the one next to this folder in the SDK checkout. */
function findCli() {
  try {
    return fileURLToPath(import.meta.resolve(SPECIFIER));
  } catch {
    const f = fileURLToPath(SIBLING);
    return existsSync(f) ? f : null;
  }
}

/** @param {string[]} args */
export const initArgs = (args) =>
  args.some((a) => a === "--template" || a === "--example")
    ? ["init", ...args]
    : ["init", ...args, "--template", "command"];

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(
    "Usage: npm create vaultdraw-plugin <id> [--template command|panel|scene]",
  );
  process.exit(args.length === 0 ? 2 : 0);
}
const cli = findCli();
if (!cli) {
  console.error("vaultdraw-plugin is not installed next to this command.");
  process.exit(2);
}
const r = spawnSync(process.execPath, [cli, ...initArgs(args)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
