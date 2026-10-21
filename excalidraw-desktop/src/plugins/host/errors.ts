/**
 * Error attribution and crash policy. An error is attributed to a plugin by
 * the guard that caught it, or (fallback) by the plugin URL in its stack.
 * 3 attributed errors in a session disable the plugin.
 */
export const MAX_PLUGIN_ERRORS = 3;
const LOG_RING = 100;

const STACK_RE = /vdplugin(?::\/\/|\.)localhost\/([a-z0-9-]+)\//;

export const attributeByStack = (err: unknown): string | null => {
  const stack =
    err && typeof err === "object" ? (err as Error).stack : undefined;
  return typeof stack === "string" ? STACK_RE.exec(stack)?.[1] ?? null : null;
};

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export interface PluginLogLine {
  level: "debug" | "info" | "warn" | "error";
  text: string;
}

const counts = new Map<string, number>();
const logs = new Map<string, PluginLogLine[]>();
const problems = new Map<string, string[]>();
let onCrash: (id: string, reason: string) => void = () => {};

/** The host's disable action; called when a plugin crosses the error limit. */
export const setCrashHandler = (fn: (id: string, reason: string) => void) => {
  onCrash = fn;
};

export function logLine(
  id: string,
  level: PluginLogLine["level"],
  text: string,
) {
  let lines = logs.get(id);
  if (!lines) {
    lines = [];
    logs.set(id, lines);
  }
  if (lines.length >= LOG_RING) {
    lines.shift();
  }
  lines.push({ level, text });
}

export const getPluginLog = (id: string): readonly PluginLogLine[] =>
  logs.get(id) ?? [];

/** A non-fatal problem (e.g. invalid declared setting); shown, never counted. */
export function reportPluginProblem(id: string, message: string): void {
  console.warn(`[plugin ${id}] ${message}`);
  logLine(id, "warn", message);
  problems.set(id, [...(problems.get(id) ?? []), message]);
}

export const getPluginProblems = (id: string): readonly string[] =>
  problems.get(id) ?? [];

/** Record an attributed error; the third one disables the plugin. */
export function reportPluginError(id: string, err: unknown, where: string) {
  const text = `${where}: ${errorText(err)}`;
  console.error(`[plugin ${id}] ${text}`, err);
  logLine(id, "error", text);
  const n = (counts.get(id) ?? 0) + 1;
  counts.set(id, n);
  if (n === MAX_PLUGIN_ERRORS) {
    onCrash(id, `${MAX_PLUGIN_ERRORS} errors (last: ${text})`);
  }
}

export const pluginErrorCount = (id: string): number => counts.get(id) ?? 0;
export const resetPluginErrors = (id: string): void => {
  counts.delete(id);
  problems.delete(id);
};

export function resetErrors(): void {
  counts.clear();
  logs.clear();
  problems.clear();
}
