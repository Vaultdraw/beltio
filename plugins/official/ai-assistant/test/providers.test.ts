import { describe, expect, it } from "vitest";

import {
  buildRequest,
  createParser,
  errorMessageOf,
  isLocalAddress,
  needsKey,
  ProviderError,
  type ProviderConfig,
  type ProviderId,
} from "../src/providers";

const cfg = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  provider: "anthropic",
  model: "",
  baseUrl: "",
  timeoutMs: 30000,
  hasKey: true,
  ...over,
});

const MSGS = [{ role: "user" as const, content: "hi" }];

describe("buildRequest", () => {
  it("Anthropic: address, version header, key by the app, system apart", () => {
    const r = buildRequest(cfg(), "SYS", MSGS);
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(r.auth).toEqual({ secret: "api-key", header: "x-api-key" });
    const body = JSON.parse(r.body!);
    expect(body).toMatchObject({ stream: true, system: "SYS", messages: MSGS });
    expect(body.model).toBeTruthy();
    expect(r.timeoutMs).toBe(30000);
  });

  it("OpenAI: bearer key, system in the messages, address override keeps no trailing slash", () => {
    const r = buildRequest(
      cfg({ provider: "openai", baseUrl: "https://gw.example.com/v1/" }),
      "SYS",
      MSGS,
    );
    expect(r.url).toBe("https://gw.example.com/v1/chat/completions");
    expect(r.auth).toEqual({
      secret: "api-key",
      header: "authorization",
      prefix: "Bearer ",
    });
    expect(JSON.parse(r.body!).messages[0]).toEqual({
      role: "system",
      content: "SYS",
    });
  });

  it("OpenAI-style server on this computer without a key sends no key header", () => {
    const r = buildRequest(
      cfg({ provider: "openai", baseUrl: "http://localhost:1234/v1", hasKey: false }),
      "S",
      MSGS,
    );
    expect(r.auth).toBeUndefined();
    expect(needsKey(cfg({ provider: "openai", baseUrl: "http://localhost:1234/v1" }))).toBe(false);
  });

  it("Ollama: this computer, no key", () => {
    const r = buildRequest(cfg({ provider: "ollama" }), "S", MSGS);
    expect(r.url).toBe("http://localhost:11434/api/chat");
    expect(r.auth).toBeUndefined();
    expect(needsKey(cfg({ provider: "ollama" }))).toBe(false);
  });

  it("the key is never in the request body or headers", () => {
    for (const provider of ["anthropic", "openai", "ollama"] as ProviderId[]) {
      const r = buildRequest(cfg({ provider }), "S", MSGS);
      expect(JSON.stringify(r)).not.toMatch(/sk-/);
    }
  });
});

describe("isLocalAddress", () => {
  it.each([
    ["http://localhost:11434", true],
    ["http://127.0.0.1:8080/v1", true],
    ["http://[::1]:8080", true],
    ["https://api.openai.com/v1", false],
    ["http://192.168.1.5:11434", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLocalAddress(url)).toBe(expected);
  });
});

/** Feeds `body` in pieces of every size from 1 to its length: the answer must not depend on the split. */
const stream = (provider: ProviderId, body: string, size: number) => {
  const p = createParser(provider);
  let out = "";
  for (let i = 0; i < body.length; i += size) {
    out += p.push(body.slice(i, i + size)).join("");
  }
  out += p.end().join("");
  return { out, done: p.done };
};

const SSE_ANTHROPIC =
  'event: message_start\ndata: {"type":"message_start"}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n' +
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo é"}}\n\n' +
  'data: {"type":"message_stop"}\n\n';
const SSE_OPENAI =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"lo é"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n";
const NDJSON =
  '{"message":{"content":"Hel"},"done":false}\n' +
  '{"message":{"content":"lo é"},"done":false}\n' +
  '{"message":{"content":""},"done":true}\n';

describe("stream parsers read every split of the bytes", () => {
  const cases: [ProviderId, string][] = [
    ["anthropic", SSE_ANTHROPIC],
    ["openai", SSE_OPENAI],
    ["ollama", NDJSON],
  ];
  for (const [provider, body] of cases) {
    it(provider, () => {
      for (const size of [1, 2, 3, 7, 50, body.length]) {
        expect(stream(provider, body, size)).toEqual({ out: "Hello é", done: true });
      }
    });
  }

  it("CRLF line ends and a last line with no newline", () => {
    const body = SSE_OPENAI.replace(/\n/g, "\r\n").trimEnd();
    expect(stream("openai", body, 5).out).toBe("Hello é");
  });

  it("garbage lines and comments are skipped, not fatal", () => {
    const body = ": ping\nnot json\ndata: {oops\n" + SSE_OPENAI;
    expect(stream("openai", body, 9).out).toBe("Hello é");
  });

  it("an error event inside the stream throws the provider's words", () => {
    const body = 'data: {"type":"error","error":{"message":"Overloaded"}}\n';
    expect(() => stream("anthropic", body, 100)).toThrow(ProviderError);
    expect(() => stream("anthropic", body, 100)).toThrow("Overloaded");
    expect(() => stream("ollama", '{"error":"model not found"}\n', 100)).toThrow("model not found");
    expect(() => stream("openai", 'data: {"error":{"message":"bad"}}\n', 100)).toThrow("bad");
  });
});

describe("errorMessageOf", () => {
  it.each([
    ['{"error":{"message":"invalid x-api-key"}}', "invalid x-api-key"],
    ['{"error":"model \\"x\\" not found"}', 'model "x" not found'],
    ["plain text body", "plain text body"],
    ["", ""],
  ])("%s", (body, expected) => {
    expect(errorMessageOf(body)).toBe(expected);
  });
});
