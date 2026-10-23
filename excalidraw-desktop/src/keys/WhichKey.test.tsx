import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { readContext } from "../commands/context";
import { installCommandDispatcher } from "../commands/dispatcher";
import { runHandler } from "../commands/dispatcher";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { buildKeymap } from "../commands/keymap";
import { buildKeyTrie } from "../commands/keyTrie";
import { KEYS_COMMANDS } from "../commands/keysCommands";
import { getPendingKeys } from "../commands/pendingKeys";
import { updatePreferences } from "../vault/preferences";

import { WhichKeyHost } from "./WhichKeyHost";

import type { CommandDefinition, CommandHandler } from "../commands/types";

const app = { vaultOpen: true, drawingOpen: true, writable: true };
const cmd = (id: string, title: string, key: string): CommandDefinition => ({
  id,
  title,
  category: "Tools",
  keys: { default: [key] },
});

const commands = [
  cmd("t.rect", "Tool: Rectangle", "g r"),
  cmd("t.ell", "Tool: Ellipse", "g e"),
  cmd("f.a", "Alpha", "<leader> f a"),
  cmd("f.b", "Beta", "<leader> f b"),
];
const handlers: Record<string, CommandHandler> = {};
let dispose: (() => void) | null = null;

const install = () => {
  const keymap = buildKeymap(commands, {}, "mac");
  const seqRoot = buildKeyTrie(commands, {}, { leader: "Space" }, "mac");
  dispose = installCommandDispatcher(window, {
    platform: "mac",
    getKeymap: () => keymap,
    getSeqRoot: () => seqRoot,
    getOptions: () => ({ leader: "Space", timeoutMs: 0, cancelAfterMs: 0 }),
    getContext: () => readContext(document, app),
    getHandler: (id) => handlers[id] ?? getRegisteredHandler(id),
  });
};

const press = (code: string, key = code) =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code,
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
const letter = (c: string) => press(`Key${c.toUpperCase()}`, c);

const setKeys = (patch: Record<string, unknown>) =>
  updatePreferences(
    {
      keysLeader: "Space",
      keysWhichKeyDelayMs: 400,
      keysWhichKey: true,
      ...patch,
    },
    window,
  );

// Warm the lazy chunk: a first dynamic import takes real time, not fake time.
beforeAll(async () => {
  await import("./WhichKey");
});

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  handlers["t.rect"] = vi.fn();
  handlers["t.ell"] = vi.fn();
  handlers["f.a"] = vi.fn();
  handlers["f.b"] = vi.fn();
  document.body.innerHTML =
    '<div class="vault-editor"><button id="c"></button></div>';
  (document.getElementById("c") as HTMLElement).focus();
});
afterEach(() => {
  cleanup();
  dispose?.();
  dispose = null;
  vi.useRealTimers();
});

const mount = async () => {
  setKeys({});
  install();
  render(<WhichKeyHost win={window} />);
};
const flushLazy = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const wait = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("WhichKeyHost", () => {
  it("appears after the delay and never before", async () => {
    await mount();
    letter("g");
    await wait(399);
    expect(screen.queryByRole("status")).toBeNull();
    await wait(2);
    await flushLazy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Tool: Rectangle")).toBeTruthy();
    expect(screen.getByText("Tool: Ellipse")).toBeTruthy();
  });

  it("lists live entries only and labels groups", async () => {
    await mount();
    delete handlers["t.ell"];
    letter("g");
    await wait(500);
    await flushLazy();
    expect(screen.getByText("Tool: Rectangle")).toBeTruthy();
    expect(screen.queryByText("Tool: Ellipse")).toBeNull();
    press("Escape");
    press("Space", " ");
    await wait(500);
    await flushLazy();
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("uses [keys.labels] for groups", async () => {
    window.localStorage.clear();
    setKeys({ keysLabels: { "<leader> f": "files" } });
    install();
    render(<WhichKeyHost win={window} />);
    press("Space", " ");
    await wait(500);
    await flushLazy();
    expect(screen.getByText("files")).toBeTruthy();
  });

  it("arrows move the highlight and Enter runs the entry", async () => {
    await mount();
    letter("g");
    await wait(500);
    await flushLazy();
    const items = () => screen.getAllByRole("listitem");
    expect(items()[0].getAttribute("aria-current")).toBe("true");
    press("ArrowDown");
    expect(items()[1].getAttribute("aria-current")).toBe("true");
    press("Enter");
    expect(handlers["t.ell"]).toHaveBeenCalledTimes(1);
    expect(getPendingKeys()).toEqual([]);
    await wait(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Enter on a group descends", async () => {
    await mount();
    press("Space", " ");
    await wait(500);
    await flushLazy();
    press("Enter");
    expect(getPendingKeys()).toEqual(["Space", "F"]);
    await flushLazy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("Escape and Backspace work through the dispatcher", async () => {
    await mount();
    press("Space", " ");
    letter("f");
    await wait(500);
    await flushLazy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    press("Backspace");
    expect(getPendingKeys()).toEqual(["Space"]);
    press("Escape");
    expect(getPendingKeys()).toEqual([]);
    await wait(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("whichKey=false sets no timer and listener", async () => {
    setKeys({ keysWhichKey: false });
    install();
    const add = vi.spyOn(window, "addEventListener");
    const timers = vi.getTimerCount();
    render(<WhichKeyHost win={window} />);
    letter("g");
    expect(getPendingKeys()).toEqual(["G"]);
    // dispatcher's own cancel listeners are the only ones added
    expect(vi.getTimerCount()).toBe(timers);
    await wait(2000);
    expect(screen.queryByRole("status")).toBeNull();
    expect(add.mock.calls.length).toBeGreaterThan(0);
  });

  it("keys.whichKey shows the root; Escape closes it", async () => {
    await mount();
    const run = getRegisteredHandler("keys.whichKey") as CommandHandler;
    expect(KEYS_COMMANDS.map((c) => c.id)).toContain("keys.whichKey");
    act(() => runHandler("keys.whichKey", run));
    await flushLazy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getAllByText("+2 more")).toHaveLength(2);
    press("Escape");
    await wait(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keys.cancel drops a pending sequence", async () => {
    await mount();
    letter("g");
    act(() =>
      runHandler(
        "keys.cancel",
        getRegisteredHandler("keys.cancel") as CommandHandler,
      ),
    );
    expect(getPendingKeys()).toEqual([]);
  });
});
