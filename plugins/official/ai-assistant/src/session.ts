/**
 * The assistant's state and the one request it runs at a time. The panel reads it with
 * `useSyncExternalStore`; commands call `run`, `cancel` and `clear`.
 */
import {
  pickElements,
  describeElements,
  textOf,
  type Context,
} from "./context";
import { insertDiagram } from "./diagram";
import { friendlyError, statusMessage } from "./errors";
import { SYSTEM, userMessage, type Task } from "./prompts";
import {
  buildRequest,
  createParser,
  DEFAULT_MODEL,
  errorMessageOf,
  isProvider,
  needsKey,
  secretNameOf,
  type ChatMessage,
  type ProviderConfig,
} from "./providers";

import type { PluginContext } from "@vaultdraw/api";

export interface SessionState {
  status: "idle" | "running";
  task: Task;
  /** What the user asked (shown above the answer). */
  request: string;
  /** What is sent besides the request: shown before and after sending. */
  context: Context | null;
  /** The whole message sent as the user turn, for the "What is sent" view. */
  sent: string;
  answer: string;
  error: string | null;
  /** The earlier turns of an `ask` conversation. */
  history: readonly ChatMessage[];
  hasKey: boolean;
  /** One line about the provider and model, e.g. "Anthropic, claude-sonnet-4-5". */
  via: string;
  /** Set after a diagram answer: the number of shapes drawn, or null. */
  drawn: number | null;
  /** Bumped by commands so the panel puts the cursor in the question box (or the key box). */
  focus: { tick: number; target: "request" | "key" };
}

export interface Session {
  get(): SessionState;
  subscribe(cb: () => void): () => void;
  /** Builds what would be sent for `task` (no request). */
  preview(
    task: Task,
    request: string,
  ): Promise<{ context: Context | null; sent: string }>;
  run(task: Task, request: string): Promise<void>;
  cancel(): void;
  clear(): void;
  refreshKey(): Promise<void>;
  setKey(value: string): Promise<void>;
  removeKey(): Promise<void>;
  /** Draws the Mermaid in the current answer. */
  draw(): Promise<void>;
  config(): ProviderConfig;
  /** A command picked a task: select it and focus the box. */
  setTask(task: Task, target?: "request" | "key"): void;
}

const PROVIDER_NAMES = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama",
} as const;

export function createSession(ctx: PluginContext): Session {
  let controller: AbortController | null = null;
  let hasKey = false;
  const listeners = new Set<() => void>();
  let state: SessionState = {
    status: "idle",
    task: "ask",
    request: "",
    context: null,
    sent: "",
    answer: "",
    error: null,
    history: [],
    hasKey: false,
    via: "",
    drawn: null,
    focus: { tick: 0, target: "request" },
  };

  const config = (): ProviderConfig => {
    const raw = ctx.settings.get<string>("provider");
    const provider = isProvider(raw) ? raw : "anthropic";
    return {
      provider,
      model: ctx.settings.get<string>("model") || DEFAULT_MODEL[provider],
      baseUrl: ctx.settings.get<string>("base_url") ?? "",
      timeoutMs:
        Math.max(5, ctx.settings.get<number>("timeout_s") || 60) * 1000,
      hasKey,
    };
  };
  const viaOf = (c: ProviderConfig) =>
    `${PROVIDER_NAMES[c.provider]}, ${c.model}`;

  const refreshKey = async () => {
    hasKey = await ctx.secret.has(secretNameOf(config()));
    set({ hasKey, via: viaOf(config()) });
  };
  // switching the provider or the address switches the key too
  for (const key of ["provider", "base_url"]) {
    ctx.subscriptions.push(
      ctx.settings.onChange(key, () => {
        void refreshKey();
      }),
    );
  }

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const cb of [...listeners]) {
      cb();
    }
  };

  const limit = () =>
    Math.max(500, ctx.settings.get<number>("max_context_chars") || 12000);

  async function contextFor(task: Task): Promise<Context | null> {
    if (task === "diagram") {
      return null;
    }
    const all = ctx.scene.elements();
    const { elements, scope } = pickElements(all, ctx.scene.selection());
    if (task === "summarise") {
      const c = textOf(elements, limit());
      return {
        ...c,
        summary: `${
          scope === "selection" ? "Selected text" : "Text of this drawing"
        }: ${c.summary}`,
      };
    }
    const c = describeElements(elements, limit());
    return {
      ...c,
      summary: `${
        scope === "selection" ? "The selection" : "The whole drawing"
      }: ${c.summary}`,
    };
  }

  async function preview(task: Task, request: string) {
    const context = await contextFor(task);
    return { context, sent: userMessage(task, request, context?.text ?? "") };
  }

  async function run(task: Task, request: string) {
    if (state.status === "running") {
      return;
    }
    // the key belongs to the provider and address chosen now (toimprove 272)
    hasKey = await ctx.secret.has(secretNameOf(config()));
    const cfg = config();
    const via = viaOf(cfg);
    const { context, sent } = await preview(task, request);
    if (task === "describe" && ctx.scene.selection().length === 0) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: "Select something in the drawing first, then run this again.",
        via,
        drawn: null,
      });
      return;
    }
    if (
      (task === "describe" || task === "ask" || task === "summarise") &&
      !context?.text
    ) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: "The drawing is empty, so there is nothing to ask about.",
        via,
        drawn: null,
      });
      return;
    }
    if (task === "diagram" && !request.trim()) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: "Say what the diagram should show.",
        via,
        drawn: null,
      });
      return;
    }
    if (needsKey(cfg) && !hasKey) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: friendlyError({ code: "SECRET_MISSING" }, cfg.provider),
        via,
        drawn: null,
      });
      return;
    }
    const prior = task === "ask" && state.task === "ask" ? state.history : [];
    const messages: ChatMessage[] = [...prior, { role: "user", content: sent }];
    controller = new AbortController();
    set({
      status: "running",
      task,
      request,
      context,
      sent,
      answer: "",
      error: null,
      via,
      drawn: null,
    });
    let answer = "";
    try {
      const res = await ctx.net.request(
        buildRequest(cfg, SYSTEM[task], messages),
        { signal: controller.signal },
      );
      if (!res.ok) {
        throw new StatusError(res.status, errorMessageOf(await res.text()));
      }
      const parser = createParser(cfg.provider);
      const dec = new TextDecoder();
      const add = (parts: string[]) => {
        if (parts.length) {
          answer += parts.join("");
          set({ answer });
        }
      };
      for await (const chunk of res.body) {
        add(parser.push(dec.decode(chunk, { stream: true })));
        if (parser.done) {
          break;
        }
      }
      add(parser.push(dec.decode()));
      add(parser.end());
      res.close();
      const history =
        task === "ask"
          ? [...messages, { role: "assistant" as const, content: answer }]
          : [];
      set({ status: "idle", history });
    } catch (err) {
      const stopped = (err as { code?: string }).code === "ABORTED";
      set({
        status: "idle",
        error: stopped
          ? null
          : err instanceof StatusError
          ? statusMessage(cfg.provider, err.status, err.detail)
          : friendlyError(err, cfg.provider),
      });
    } finally {
      controller = null;
    }
  }

  return {
    get: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    preview,
    run,
    cancel() {
      controller?.abort();
    },
    clear() {
      controller?.abort();
      set({
        status: "idle",
        request: "",
        context: null,
        sent: "",
        answer: "",
        error: null,
        history: [],
        drawn: null,
      });
    },
    refreshKey,
    async setKey(value) {
      await ctx.secret.set(secretNameOf(config()), value.trim());
      hasKey = true;
      set({ hasKey, error: null });
    },
    async removeKey() {
      await ctx.secret.delete(secretNameOf(config()));
      hasKey = false;
      set({ hasKey });
    },
    async draw() {
      try {
        const n = await insertDiagram(ctx, state.answer);
        set({ drawn: n, error: null });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },
    config,
    setTask(task, target = "request") {
      set({ task, focus: { tick: state.focus.tick + 1, target } });
    },
  };
}

class StatusError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`status ${status}`);
  }
}
