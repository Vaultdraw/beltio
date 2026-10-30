/**
 * Hunter M (2026-10-30 night): the AI assistant panel's buttons, on the mock host with the
 * scripted provider (nothing leaves the machine).
 * Reference: Zed's assistant panel and Obsidian's AI chat plugins keep a message the app refused to
 * send in the box, and every copy says it copied (the app's own rule, toimprove 207).
 */
import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

const sse = (...parts: string[]) => [
  ...parts.map(
    (t) => `data: {"choices":[{"delta":{"content":${JSON.stringify(t)}}}]}\n\n`,
  ),
  "data: [DONE]\n\n",
];

async function start(opts: { key?: boolean } = {}) {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", "openai");
  p.scene.setElements([{ type: "text", x: 10, y: 10, text: "Login page" }]);
  if (opts.key !== false) {
    p.net.secrets["ai-assistant"] = { "api-key": "sk-test-1" };
  }
  await p.openPanel("assistant");
}

const box = () =>
  screen.getByLabelText("Ask about this drawing") as HTMLTextAreaElement;
const send = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

describe("a refused Send keeps the question (toimprove M-15)", () => {
  it("(context) a sent question empties the box", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("ok") });
    send("What is on it?");
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());
    expect(box().value).toBe("");
  });

  it.fails("no key: the message says so and the question stays", async () => {
    await start({ key: false });
    send("What is on it?");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("No API key"),
    );
    expect(p!.net.requests.length).toBe(0);
    expect(box().value).toBe("What is on it?");
  });

  it.fails(
    "Offline mode: the message says so and the question stays",
    async () => {
      await start();
      p!.net.offline = () => true;
      send("What is on it?");
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain("Offline mode"),
      );
      expect(box().value).toBe("What is on it?");
    },
  );
});

describe("Copy under an answer reports what happened (toimprove M-16)", () => {
  (
    [
      ["the clipboard takes it", () => Promise.resolve()],
      ["the clipboard refuses", () => Promise.reject(new Error("denied"))],
    ] as const
  ).forEach(([what, write]) => {
    it.fails(`${what}: a notice says so`, async () => {
      await start();
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn(write) },
        configurable: true,
      });
      p!.net.respond = () => ({ chunks: sse("Two pages.") });
      send("Pages?");
      await waitFor(() => expect(screen.getByText("Two pages.")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await waitFor(() => expect(p!.toasts().length).toBeGreaterThan(0));
    });
  });
});

// toimprove M-17: one secret ("api-key", providers.ts SECRET_NAME) is sent to whichever provider and
// address are selected. A key saved for Anthropic goes to api.openai.com after switching the
// provider; an OpenAI key goes to any OpenAI-style address typed into Address. Reference: Zed keeps
// a credential per provider API URL; Obsidian Copilot one key field per provider.
describe("a key goes only to the service it was saved for (toimprove M-17)", () => {
  const anthropicKey = "sk-ant-SECRET-for-anthropic";

  it("(context) the key goes to the provider it was saved under", async () => {
    p = await boot(manifest(), plugin);
    await p.setSetting("provider", "anthropic");
    p.scene.setElements([{ type: "text", x: 10, y: 10, text: "Login page" }]);
    p.net.secrets["ai-assistant"] = { "api-key": anthropicKey };
    await p.openPanel("assistant");
    p.net.respond = () => ({ chunks: [] });
    send("hi");
    await waitFor(() => expect(p!.net.requests.length).toBe(1));
    expect(p.net.requests[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(p.net.requests[0].authHeader?.value).toBe(anthropicKey);
  });

  (
    [
      ["switched to OpenAI", { provider: "openai" }],
      [
        "OpenAI-style address of another service",
        { provider: "openai", base_url: "https://api.example-llm.com/v1" },
      ],
    ] as const
  ).forEach(([what, settings]) => {
    it.fails(`${what}: the saved key is not sent there`, async () => {
      p = await boot(manifest(), plugin);
      await p.setSetting("provider", "anthropic");
      p.scene.setElements([{ type: "text", x: 10, y: 10, text: "Login page" }]);
      await p.openPanel("assistant");
      // Saved while the provider was Anthropic, through the panel as a user does.
      fireEvent.change(screen.getByLabelText("API key"), {
        target: { value: anthropicKey },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save key" }));
      await waitFor(() =>
        expect(screen.getByText(/A key is saved/)).toBeTruthy(),
      );
      for (const [k, v] of Object.entries(settings)) {
        await p.setSetting(k, v);
      }
      p.net.respond = () => ({ chunks: [] });
      send("hi");
      await new Promise((r) => setTimeout(r, 100));
      const sent = p.net.requests.map((r) => r.authHeader?.value ?? "");
      expect(sent.join(" ")).not.toContain(anthropicKey);
    });
  });
});
