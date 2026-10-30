/** Plain-words messages for what can go wrong: no codes, no jargon, one next step. */
import { ProviderError } from "./providers";

import type { ProviderId } from "./providers";

const NAMES: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama",
};

/** The message for an answer with a status outside 200 to 299. `detail` is the provider's own text. */
export function statusMessage(
  provider: ProviderId,
  status: number,
  detail: string,
): string {
  const name = NAMES[provider];
  const extra = detail ? ` ${name} says: ${detail}` : "";
  if (status === 401 || status === 403) {
    return `${name} did not accept the key. Check it with "AI: Set API key".${extra}`;
  }
  if (status === 404) {
    return provider === "ollama"
      ? `Ollama does not have that model. Pull it first, or change the model in the AI settings.${extra}`
      : `${name} does not know that model or address. Check the model and address in the AI settings.${extra}`;
  }
  if (status === 408 || status === 504) {
    return `${name} took too long to answer. Try again, or raise the timeout in the AI settings.`;
  }
  if (status === 429) {
    return `${name} says there have been too many requests, or the quota is used up. Wait a moment and try again.${extra}`;
  }
  if (status >= 500) {
    return `${name} has a problem on its side (status ${status}). Try again in a moment.${extra}`;
  }
  return `${name} refused the request (status ${status}).${extra}`;
}

/** The message for any thrown error. */
export function friendlyError(err: unknown, provider: ProviderId): string {
  const name = NAMES[provider];
  if (err instanceof ProviderError) {
    return `${name} reported a problem: ${err.message}`;
  }
  const code = (err as { code?: string } | null)?.code;
  const message = (err as Error | null)?.message ?? String(err);
  switch (code) {
    case "NETWORK_DISABLED":
      return "Offline mode is on, so nothing was sent. Turn Offline mode off in Settings, or use a model on this computer (Ollama).";
    case "NETWORK_NOT_ALLOWED":
      return "AI requests are turned off by network.allow_ai in your config file. Remove it or set it to true.";
    case "SECRET_MISSING":
      return `No API key is saved. Use "AI: Set API key" to add one.`;
    case "NETWORK_TIMEOUT":
      return `${name} did not answer in time. Try again, or raise the timeout in the AI settings.`;
    case "PRIVATE_ADDRESS":
    case "INVALID_URL":
      return `That address cannot be used: ${message}`;
    case "TOO_LARGE":
      return "The answer was longer than the limit and was cut off.";
    case "ABORTED":
      return "Stopped.";
    case "NETWORK_ERROR":
      return provider === "ollama"
        ? "Could not reach Ollama. Is it running on this computer?"
        : `Could not reach ${name}. Check your connection and the address in the AI settings.`;
    case "PERMISSION":
      return "The AI assistant does not have the permission it needs. Turn it off and on again in Settings, Plugins.";
    default:
      return message;
  }
}
