import { errorMessage } from "../vault/types";

/**
 * Plain-words text for an error shown in the UI. Raw exception text
 * (TypeError, "os error 13", stack traces, backend codes) never reaches the
 * user; `userErrorDetail` keeps it for logs and "View report".
 *
 * Errors the vault backend raises with a known code already carry a sentence
 * written for people, so those pass through.
 */

/** Codes whose message the backend writes for people (fsops.rs). */
const PLAIN_CODES = new Set(["NAME_COLLISION", "INVALID_FILE", "INVALID_PATH"]);

const CODE_TEXT: Record<string, string> = {
  NOT_FOUND:
    "The file is no longer there. It may have been moved or deleted outside Vaultdraw.",
  READ_ONLY: "This vault is read-only, so nothing can be changed in it.",
};

/** Operating-system failures, matched on the raw text. */
const OS_TEXT: Array<[RegExp, string]> = [
  [
    /permission denied|operation not permitted|EACCES|EPERM|os error (1|13)\b/i,
    "Vaultdraw isn't allowed to change this file. Check the folder's sharing and permissions.",
  ],
  [/no space left|ENOSPC|os error 28\b/i, "The disk is full."],
  [
    /no such file|ENOENT|os error 2\b/i,
    "The file is no longer there. It may have been moved or deleted outside Vaultdraw.",
  ],
  [
    /network|failed to fetch|timed? ?out|ETIMEDOUT|ECONNREFUSED/i,
    "Couldn't connect. Check the connection and try again.",
  ],
];

const codeOf = (err: unknown): string | undefined => {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

/** Looks like a sentence written for people, not a raw exception. */
const isPlainSentence = (text: string): boolean =>
  /^[A-Z“"]/.test(text) &&
  !/\n|\bat \S+:\d+|Error:|undefined|null|\bos error\b|[{}[\]`]|\b[A-Z][A-Z_]{3,}\b/.test(
    text,
  ) &&
  text.length <= 200;

export const userErrorDetail = (err: unknown): string => errorMessage(err);

/**
 * @param err the thrown value
 * @param fallback what failed, as a full sentence ("Couldn't rename the file.")
 */
export const userError = (
  err: unknown,
  fallback = "Something went wrong.",
): string => {
  const code = codeOf(err);
  const raw = errorMessage(err);
  if (code && CODE_TEXT[code]) {
    return CODE_TEXT[code];
  }
  if (code && PLAIN_CODES.has(code) && raw) {
    return raw;
  }
  for (const [pattern, text] of OS_TEXT) {
    if (pattern.test(raw)) {
      return text;
    }
  }
  if (!code && !(err instanceof TypeError) && isPlainSentence(raw)) {
    return raw;
  }
  return fallback;
};
