/**
 * One small adapter per provider: how to build the request and how to read the stream back.
 * Pure (no host calls), so each wire format is tested with plain strings.
 */
import type { NetRequest } from "@vaultdraw/api";

export type ProviderId = "anthropic" | "openai" | "ollama";

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  /** Empty: the provider's usual address. */
  baseUrl: string;
  timeoutMs: number;
  /** Whether a key is stored (an OpenAI-style server on this computer may need none). */
  hasKey: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const DEFAULT_BASE: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434",
};

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  ollama: "llama3.2",
};

export const isProvider = (v: unknown): v is ProviderId =>
  v === "anthropic" || v === "openai" || v === "ollama";

/** A server on this computer: no key needed for an OpenAI-style one. */
export const isLocalAddress = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
};

export const baseUrlOf = (cfg: ProviderConfig): string =>
  (cfg.baseUrl.trim() || DEFAULT_BASE[cfg.provider]).replace(/\/+$/, "");

/**
 * The name a key is saved under: one key per provider and address, so a key saved for one service
 * is never sent to another (toimprove 272; Zed keeps a credential per provider API URL). The
 * default Anthropic address keeps the first release's plain "api-key".
 */
export const secretNameOf = (cfg: ProviderConfig): string => {
  const base = baseUrlOf(cfg);
  if (cfg.provider === "anthropic" && base === DEFAULT_BASE.anthropic) {
    return "api-key";
  }
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    // an address that does not parse is refused later; keep a stable name for it
  }
  return `api-key-${cfg.provider}-${host.toLowerCase()}`
    .replace(/[^a-z0-9._-]/g, "-")
    .slice(0, 64);
};

/** Whether this provider needs a stored key to be asked. */
export const needsKey = (cfg: ProviderConfig): boolean =>
  cfg.provider === "anthropic" ||
  (cfg.provider === "openai" && !isLocalAddress(baseUrlOf(cfg)));

export function buildRequest(
  cfg: ProviderConfig,
  system: string,
  messages: readonly ChatMessage[],
): NetRequest {
  const base = baseUrlOf(cfg);
  const model = cfg.model.trim() || DEFAULT_MODEL[cfg.provider];
  const common = { method: "POST" as const, timeoutMs: cfg.timeoutMs };
  if (cfg.provider === "anthropic") {
    return {
      ...common,
      url: `${base}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      auth: { secret: secretNameOf(cfg), header: "x-api-key" },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system,
        messages,
      }),
    };
  }
  const withSystem = [{ role: "system", content: system }, ...messages];
  if (cfg.provider === "openai") {
    return {
      ...common,
      url: `${base}/chat/completions`,
      headers: { "content-type": "application/json" },
      ...(cfg.hasKey || !isLocalAddress(base)
        ? {
            auth: {
              secret: secretNameOf(cfg),
              header: "authorization",
              prefix: "Bearer ",
            },
          }
        : {}),
      body: JSON.stringify({ model, stream: true, messages: withSystem }),
    };
  }
  return {
    ...common,
    url: `${base}/api/chat`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages: withSystem }),
  };
}

/** A failure the provider reported inside a stream or an error body. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Text in, answer text out. `push` may be called with any split of the bytes. */
export interface StreamParser {
  push(text: string): string[];
  /** Call at the end of the body: flushes a last line without a newline. */
  end(): string[];
  /** True once the provider said the answer is complete. */
  readonly done: boolean;
}

/** Splits a stream into lines and hands each to `onLine`. */
function lineParser(
  onLine: (line: string) => string | null,
  isDone: () => boolean,
): StreamParser {
  let rest = "";
  const take = (lines: string[]) =>
    lines.flatMap((l) => {
      const out = onLine(l.replace(/\r$/, ""));
      return out ? [out] : [];
    });
  return {
    push(text) {
      rest += text;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      return take(lines);
    },
    end() {
      const last = rest;
      rest = "";
      return last ? take([last]) : [];
    },
    get done() {
      return isDone();
    },
  };
}

const parseJson = (text: string): Record<string, any> | null => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

const errorText = (e: unknown): string => {
  if (typeof e === "string") {
    return e;
  }
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "The provider reported an error";
};

export function createParser(provider: ProviderId): StreamParser {
  let finished = false;
  if (provider === "ollama") {
    return lineParser(
      (line) => {
        const j = line.trim() ? parseJson(line) : null;
        if (!j) {
          return null;
        }
        if (j.error) {
          throw new ProviderError(errorText(j.error));
        }
        if (j.done) {
          finished = true;
        }
        const text = j.message?.content;
        return typeof text === "string" && text ? text : null;
      },
      () => finished,
    );
  }
  return lineParser(
    (line) => {
      if (!line.startsWith("data:")) {
        return null;
      }
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        finished = true;
        return null;
      }
      const j = parseJson(data);
      if (!j) {
        return null;
      }
      if (provider === "anthropic") {
        if (j.type === "error") {
          throw new ProviderError(errorText(j.error));
        }
        if (j.type === "message_stop") {
          finished = true;
        }
        const t = j.type === "content_block_delta" ? j.delta?.text : undefined;
        return typeof t === "string" && t ? t : null;
      }
      if (j.error) {
        throw new ProviderError(errorText(j.error));
      }
      const choice = j.choices?.[0];
      if (choice?.finish_reason) {
        finished = true;
      }
      const t = choice?.delta?.content;
      return typeof t === "string" && t ? t : null;
    },
    () => finished,
  );
}

/** The provider's own message out of an error body (JSON `error.message`, or the plain text). */
export function errorMessageOf(body: string): string {
  const j = parseJson(body);
  const e = j?.error ?? j?.message;
  if (e !== undefined) {
    return errorText(e).slice(0, 300);
  }
  return body.trim().slice(0, 300);
}
