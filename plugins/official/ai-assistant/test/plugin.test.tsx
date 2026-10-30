import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

const KEY = "sk-test-SECRET-1234";
const sse = (...parts: string[]) => [
  ...parts.map((t) => `data: {"choices":[{"delta":{"content":${JSON.stringify(t)}}}]}\n\n`),
  "data: [DONE]\n\n",
];

/** A booted plugin with the panel open, an OpenAI provider and a key saved. */
async function start(opts: { key?: boolean; provider?: string } = {}) {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", opts.provider ?? "openai");
  p.scene.setElements([
    { type: "text", x: 10, y: 10, text: "Login page" },
    { type: "text", x: 10, y: 80, text: "Secret plan" },
  ]);
  if (opts.key !== false) {
    p.net.secrets["ai-assistant"] = { "api-key": KEY };
  }
  const view = await p.openPanel("assistant");
  return view;
}

const ask = async (text: string) => {
  fireEvent.change(screen.getByLabelText("Ask about this drawing"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

describe("manifest", () => {
  it("asks only for what it needs and declares every command", () => {
    const m = manifest();
    expect(m.permissions).toEqual(["net", "secret"]);
    expect(m.contributes.commands.map((c) => c.id)).toEqual([
      "ask", "describe", "diagram", "summarise", "cancel", "clear", "set-key", "remove-key",
    ]);
    expect(m.contributes.settings.map((s) => s.key)).toEqual([
      "provider", "model", "base_url", "timeout_s", "max_context_chars",
    ]);
  });
});

describe("ask", () => {
  it("streams the answer, sends the key through the app and never in the request", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("Two ", "texts."), chunkDelayMs: 1 });
    await ask("What is on it?");
    await waitFor(() => expect(screen.getByText("Two texts.")).toBeTruthy());
    const [req] = p!.net.requests;
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.authHeader).toEqual({ name: "authorization", value: `Bearer ${KEY}` });
    // Everything the page controlled (not the header the app adds itself) is free of the key.
    expect(JSON.stringify({ ...req, authHeader: undefined })).not.toContain(KEY);
    const body = JSON.parse(req.body!);
    expect(body.stream).toBe(true);
    expect(body.messages.at(-1).content).toContain("Login page");
    expect(body.messages.at(-1).content).toContain("What is on it?");
  });

  it("a follow-up keeps the earlier turns", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("A1") });
    await ask("first");
    await waitFor(() => expect(screen.getByText("A1")).toBeTruthy());
    p!.net.respond = () => ({ chunks: sse("A2") });
    await ask("second");
    await waitFor(() => expect(screen.getByText("A2")).toBeTruthy());
    const roles = JSON.parse(p!.net.requests[1].body!).messages.map((m: any) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });

  it("Stop cancels the request and keeps what arrived, with no error", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("Part one ", "part two ", "part three"), chunkDelayMs: 40 });
    await ask("go");
    await waitFor(() => expect(screen.getByText(/Part one/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(p!.net.closed.length).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/part three/)).toBeNull();
  });

  it("the AI: Stop the answer command does the same", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("a", "b", "c", "d"), chunkDelayMs: 40 });
    await ask("go");
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy());
    await p!.run("cancel");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(p!.net.closed.length).toBe(1);
  });

  it("is idle and free until used: no request when the panel opens", async () => {
    await start();
    expect(p!.net.requests).toEqual([]);
  });
});

describe("errors the user can fix", () => {
  const cases: [string, () => Promise<void> | void, RegExp][] = [];
  it.each([
    [401, '{"error":{"message":"Incorrect API key"}}', /did not accept the key.*Incorrect API key/],
    [429, '{"error":{"message":"Rate limit"}}', /too many requests/],
    [500, "oops", /problem on its side/],
    [404, '{"error":{"message":"no such model"}}', /does not know that model/],
  ])("status %s", async (status, chunk, re) => {
    await start();
    p!.net.respond = () => ({ status: status as number, chunks: [chunk as string] });
    await ask("hi");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(re as RegExp));
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("no key: says so and sends nothing", async () => {
    await start({ key: false });
    await ask("hi");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No API key is saved/));
    expect(p!.net.requests).toEqual([]);
  });

  it("Offline mode: plain words, nothing sent to another computer", async () => {
    await start();
    p!.net.offline = () => true;
    await ask("hi");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Offline mode is on, so nothing was sent/));
    expect(p!.net.requests).toEqual([]);
  });

  it("Offline mode still reaches Ollama on this computer", async () => {
    await start({ provider: "ollama", key: false });
    p!.net.offline = () => true;
    p!.net.respond = () => ({ chunks: ['{"message":{"content":"local ok"},"done":false}\n', '{"done":true}\n'] });
    await ask("hi");
    await waitFor(() => expect(screen.getByText("local ok")).toBeTruthy());
    expect(p!.net.requests[0].url).toBe("http://localhost:11434/api/chat");
  });

  it("a break in the connection after some words keeps the words and says why", async () => {
    await start();
    p!.net.respond = () => ({ chunks: [sse("Half an ans")[0]], error: { code: "NETWORK_ERROR", message: "reset" } });
    await ask("hi");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not reach/));
    expect(screen.getByText(/Half an ans/)).toBeTruthy();
  });

  it("an error inside the stream shows the provider's message", async () => {
    await start({ provider: "anthropic" });
    p!.net.respond = () => ({ chunks: ['data: {"type":"error","error":{"message":"Overloaded"}}\n\n'] });
    await ask("hi");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Overloaded/));
  });
  void cases;
});

describe("what is sent", () => {
  it("only the selection is sent for Describe, and the panel shows exactly that", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("It is a title.") });
    p!.scene.select([p!.scene.live()[0].id]);
    await p!.run("describe");
    await waitFor(() => expect(screen.getByText("It is a title.")).toBeTruthy());
    const sent = JSON.parse(p!.net.requests[0].body!).messages.at(-1).content as string;
    expect(sent).toContain("Login page");
    expect(sent).not.toContain("Secret plan");
    fireEvent.click(screen.getByLabelText("Show what is sent"));
    await waitFor(() => expect(screen.getByLabelText("What is sent").textContent).toContain("Login page"));
    expect(screen.getByLabelText("What is sent").textContent).not.toContain("Secret plan");
  });

  it("Describe with nothing selected asks for a selection and sends nothing", async () => {
    await start();
    await p!.run("describe");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Select something/));
    expect(p!.net.requests).toEqual([]);
  });

  it("Summarise sends the words only, in reading order", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("Summary.") });
    await p!.run("summarise");
    await waitFor(() => expect(screen.getByText("Summary.")).toBeTruthy());
    const sent = JSON.parse(p!.net.requests[0].body!).messages.at(-1).content as string;
    expect(sent).toContain("Login page\n\nSecret plan");
    expect(sent).not.toContain("size");
  });

  it("an empty drawing is not sent", async () => {
    await start();
    p!.scene.setElements([]);
    await p!.run("summarise");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/nothing to ask about/));
    expect(p!.net.requests).toEqual([]);
  });

  it("the diagram request sends the user's words and asks for Mermaid only", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("```mermaid\nflowchart TD\nA-->B\n```") });
    fireEvent.click(screen.getByRole("tab", { name: "Generate a diagram" }));
    fireEvent.change(screen.getByLabelText(/Describe the diagram/), { target: { value: "login flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Draw it" })).toBeTruthy());
    const msgs = JSON.parse(p!.net.requests[0].body!).messages;
    expect(msgs[0].content).toMatch(/Mermaid/);
    expect(msgs.at(-1).content).toBe("login flow");
  });
});

describe("the key", () => {
  it("is saved through the app, shown as saved, and cannot be read back", async () => {
    await start({ key: false });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: `  ${KEY} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(p!.net.secrets["ai-assistant"]?.["api-key"]).toBe(KEY));
    await waitFor(() => expect(screen.getByText(/A key is saved on this computer/)).toBeTruthy());
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain(KEY);
    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
  });

  it("AI: Remove API key deletes it", async () => {
    await start();
    await p!.run("remove-key");
    expect(p!.net.secrets["ai-assistant"]).toEqual({});
    expect(p!.toasts().join(" ")).toMatch(/key removed/);
  });

  it("AI: Set API key opens the panel on the key box", async () => {
    await start({ key: false });
    await p!.run("set-key");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("API key")));
  });

  it("a plugin without the permissions cannot use the app's network or key store", async () => {
    const m = { ...manifest(), permissions: [] as string[] };
    m.contributes = { ...m.contributes, commands: [{ id: "t", title: "t", keys: [], when: [], palette: true }] };
    const calls: string[] = [];
    p = await boot(m as any, {
      activate(ctx: any) {
        ctx.commands.register("t", async () => {
          for (const f of [
            () => ctx.net.request({ url: "https://example.com" }),
            () => ctx.secret.set("api-key", "x"),
            () => ctx.secret.has("api-key"),
          ]) {
            await f().catch((e: any) => calls.push(e.code));
          }
        });
      },
    } as any);
    await p.run("t");
    expect(calls).toEqual(["PERMISSION", "PERMISSION", "PERMISSION"]);
    expect(p.net.requests).toEqual([]);
  });
});
