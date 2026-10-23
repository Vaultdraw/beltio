#!/usr/bin/env node
// Entry point. Loads only what the chosen command needs, so `--version` and `check` start fast.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const USAGE = `Usage: vaultdraw-plugin <command> [options]

Commands:
  check <dir> [--json]       Static checks of a plugin folder (exit 1 on errors)
  init <id> [--example hello-command|focus-timer|stamp] [--dir <parent>]
                             Create a plugin folder from an example
  dev <dir> [--config-dir <dir>] [--once] [--print-env]
                             Keep a copy of the plugin in the app's plugins folder

Options:
  -h, --help                 Show this help
  -v, --version              Show the version

Exit codes: 0 ok, 1 findings or refusal, 2 usage or environment error.
`;

const OPTIONS = {
  check: { json: { type: "boolean" } },
  init: { example: { type: "string" }, dir: { type: "string" } },
  dev: {
    "config-dir": { type: "string" },
    once: { type: "boolean" },
    "print-env": { type: "boolean" },
  },
};
const POSITIONALS = { check: 1, init: 1, dev: 1 };

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
      return (await import("../src/check.mjs")).runCheck(
        arg,
        { json: v.json },
        out,
      );
    }
    if (cmd === "init") {
      if (!arg) {
        err("Missing the plugin id: vaultdraw-plugin init <id>");
        return 2;
      }
      return (await import("../src/init.mjs")).runInit(
        arg,
        { example: v.example, dir: v.dir },
        out,
      );
    }
    return await (
      await import("../src/dev.mjs")
    ).runDev(
      arg,
      {
        configDir: v["config-dir"],
        once: v.once,
        printEnv: v["print-env"],
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
