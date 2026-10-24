#!/usr/bin/env node
// Entry point. Loads only what the chosen command needs, so `--version` and `check` start fast.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const USAGE = `Usage: vaultdraw-plugin <command> [options]

Commands:
  check <dir|file.zip> [--json] [--activate [--timeout <ms>]]
                             Static checks of a plugin folder or package (exit 1 on errors).
                             --activate also runs activate() once in a dry host (folder only)
  init <id> [--example hello-command|focus-timer|stamp | --template command|panel|scene] [--dir <parent>]
                             Create a plugin folder from an example (JavaScript) or a
                             template (TypeScript project)
  build [dir] [--watch]      Bundle a TypeScript project into dist/ with esbuild
  package <dir> [--out <dir>] [--json]
                             Check, then write <id>-<version>.zip and its .sha256 file
  dev <dir> [--config-dir <dir>] [--once] [--print-env]
  dev <dir> --sandbox [--app <path>]
                             Keep a copy of the plugin in the app's plugins folder, or (--sandbox)
                             start the app on a throwaway config, state and vault

Options:
  -h, --help                 Show this help
  -v, --version              Show the version

Exit codes: 0 ok, 1 findings or refusal, 2 usage or environment error.
`;

const OPTIONS = {
  check: {
    json: { type: "boolean" },
    activate: { type: "boolean" },
    timeout: { type: "string" },
  },
  init: {
    example: { type: "string" },
    template: { type: "string" },
    dir: { type: "string" },
  },
  build: { watch: { type: "boolean" } },
  package: { out: { type: "string" }, json: { type: "boolean" } },
  dev: {
    "config-dir": { type: "string" },
    once: { type: "boolean" },
    "print-env": { type: "boolean" },
    sandbox: { type: "boolean" },
    app: { type: "string" },
  },
};
const POSITIONALS = { check: 1, init: 1, dev: 1, build: 1, package: 1 };

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>} the exit code
 */
async function main(argv, env = process.env) {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help" || cmd === "help") {
    (cmd === undefined ? err : out)(USAGE.trimEnd());
    return cmd === undefined ? 2 : 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    out(
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return 0;
  }
  if (!(cmd in OPTIONS)) {
    err(`Unknown command '${cmd}'. Run vaultdraw-plugin --help.`);
    return 2;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        ...OPTIONS[/** @type {keyof typeof OPTIONS} */ (cmd)],
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (e) {
    err(
      `${
        /** @type {Error} */ (e).message.replace(
          /\. To specify a positional.*$/,
          "",
        )
      }. Run vaultdraw-plugin --help.`,
    );
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    out(USAGE.trimEnd());
    return 0;
  }
  const max = POSITIONALS[/** @type {keyof typeof POSITIONALS} */ (cmd)];
  if (positionals.length > max) {
    err(
      `Unexpected argument '${positionals[max]}'. Run vaultdraw-plugin --help.`,
    );
    return 2;
  }
  const arg = positionals[0];
  const v = /** @type {Record<string, any>} */ (values);
  try {
    if (cmd === "check") {
      if (!arg) {
        err("Missing the plugin folder: vaultdraw-plugin check <dir>");
        return 2;
      }
      if (v.timeout !== undefined && !v.activate) {
        err(
          "--timeout only works with --activate. Run vaultdraw-plugin --help.",
        );
        return 2;
      }
      let timeoutMs;
      if (v.timeout !== undefined) {
        timeoutMs = Number(v.timeout);
        if (
          !Number.isInteger(timeoutMs) ||
          timeoutMs < 100 ||
          timeoutMs > 60000
        ) {
          err(
            "--timeout must be a whole number of milliseconds from 100 to 60000.",
          );
          return 2;
        }
      }
      return await (
        await import("../src/check.mjs")
      ).runCheck(arg, { json: v.json, activate: v.activate, timeoutMs }, out);
    }
    if (cmd === "init") {
      if (!arg) {
        err("Missing the plugin id: vaultdraw-plugin init <id>");
        return 2;
      }
      return (await import("../src/init.mjs")).runInit(
        arg,
        { example: v.example, template: v.template, dir: v.dir },
        out,
      );
    }
    if (cmd === "build") {
      return await (
        await import("../src/build.mjs")
      ).runBuild(arg, { watch: v.watch }, out, err);
    }
    if (cmd === "package") {
      if (!arg) {
        err("Missing the plugin folder: vaultdraw-plugin package <dir>");
        return 2;
      }
      return await (
        await import("../src/package.mjs")
      ).runPackage(arg, { out: v.out, json: v.json }, out, err);
    }
    return await (
      await import("../src/dev.mjs")
    ).runDev(
      arg,
      {
        configDir: v["config-dir"],
        once: v.once,
        printEnv: v["print-env"],
        sandbox: v.sandbox,
        app: v.app,
        env,
      },
      out,
      err,
    );
  } catch (e) {
    if (/** @type {Error} */ (e)?.name === "EnvError") {
      err(/** @type {Error} */ (e).message);
      return 2;
    }
    if (
      /** @type {any} */ (e)?.code &&
      /^E[A-Z]+$/.test(/** @type {any} */ (e).code)
    ) {
      err(`${/** @type {Error} */ (e).message}`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
