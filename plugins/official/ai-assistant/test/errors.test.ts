import { describe, expect, it } from "vitest";

import { friendlyError, statusMessage } from "../src/errors";
import { ProviderError } from "../src/providers";

describe("statusMessage says what to do, in plain words", () => {
  it.each([
    [401, "anthropic", /did not accept the key/],
    [403, "openai", /did not accept the key/],
    [404, "ollama", /Pull it first/],
    [404, "openai", /does not know that model/],
    [429, "anthropic", /too many requests/],
    [500, "openai", /problem on its side/],
    [529, "anthropic", /problem on its side/],
    [408, "openai", /too long/],
    [400, "openai", /refused the request \(status 400\)/],
  ] as const)("%s %s", (status, provider, re) => {
    expect(statusMessage(provider, status, "")).toMatch(re);
  });

  it("adds the provider's own words, and no code names or backticks", () => {
    const m = statusMessage("anthropic", 401, "invalid x-api-key");
    expect(m).toContain("invalid x-api-key");
    expect(m).not.toMatch(/`|[A-Z_]{6,}/);
  });
});

describe("friendlyError", () => {
  it.each([
    ["NETWORK_DISABLED", /Offline mode is on, so nothing was sent/],
    ["NETWORK_NOT_ALLOWED", /turned off in Settings/],
    ["SECRET_MISSING", /No API key is saved/],
    ["NETWORK_TIMEOUT", /did not answer in time/],
    ["NETWORK_ERROR", /Could not reach/],
    ["TOO_LARGE", /cut off/],
    ["PERMISSION", /permission/],
  ])("%s", (code, re) => {
    expect(friendlyError({ code, message: "x" }, "openai")).toMatch(re);
  });

  it("Ollama unreachable names Ollama", () => {
    expect(friendlyError({ code: "NETWORK_ERROR" }, "ollama")).toMatch(/Is it running/);
  });

  it("a provider error and an unknown error keep their message", () => {
    expect(friendlyError(new ProviderError("Overloaded"), "anthropic")).toMatch(/Overloaded/);
    expect(friendlyError(new Error("boom"), "openai")).toBe("boom");
  });
});
