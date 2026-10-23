/** history.start (D8) gates HistoryHost: nothing is configured before the start. */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { HistoryHost } from "../history/HistoryHost";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";
import { updatePreferences } from "../vault/preferences";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

vi.mock("../history/panel/HistoryPanel", () => ({
  default: () => <div data-testid="mock-panel" />,
}));

const H = "fake-handle-1";
const P = "Sketches/plan.excalidraw";
const SETTINGS = toHistorySettings(HISTORY_DEFAULTS);

let repo: FakeHistoryRepository;
let start: ReturnType<typeof vi.fn>;

const mount = async (status: "saved" | "dirty" = "saved") => {
  const ui = (s: "saved" | "dirty") => (
    <HistoryHost
      repository={repo}
      vault={{ handle: H, readOnly: false }}
      settings={SETTINGS}
      document={{ id: `${H}:1:${P}`, path: P, revision: "r1" }}
      flush={async () => {}}
      ownerDocument={document}
      status={s}
    />
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(ui(status));
  });
  return {
    setStatus: (s: "saved" | "dirty") =>
      act(async () => {
        view.rerender(ui(s));
      }),
  };
};

beforeEach(() => {
  window.localStorage.clear();
  repo = new FakeHistoryRepository(H);
  start = vi.fn(async () => {});
  (repo as any).start = start;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("HistoryHost history.start", () => {
  it("open: configures and reports the document at mount, start called once", async () => {
    updatePreferences({ historyStart: "open" });
    await mount();
    expect(start).toHaveBeenCalledTimes(1);
    expect(repo.calls).toContain("configure");
    expect(repo.calls).toContain("opened");
  });

  it("use: nothing is configured or opened at mount", async () => {
    updatePreferences({ historyStart: "use" });
    await mount();
    expect(start).not.toHaveBeenCalled();
    expect(repo.calls).not.toContain("configure");
    expect(repo.calls).not.toContain("opened");
  });

  it("use: the first edit (status != saved) starts, configures and opens the current drawing", async () => {
    updatePreferences({ historyStart: "use" });
    const { setStatus } = await mount();
    await setStatus("dirty");
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(H);
    await vi.waitFor(() => expect(repo.calls).toContain("opened"));
    expect(repo.calls.indexOf("configure")).toBeLessThan(
      repo.calls.indexOf("opened"),
    );
    await setStatus("saved");
    await setStatus("dirty");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("use: opening the panel starts it", async () => {
    updatePreferences({ historyStart: "use" });
    await mount();
    expect(start).not.toHaveBeenCalled();
    act(() => void getRegisteredHandler("history.toggle")!());
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(repo.calls).toContain("opened"));
  });

  it("use: the checkpoint dialog starts it", async () => {
    updatePreferences({ historyStart: "use" });
    await mount();
    act(() => void getRegisteredHandler("history.checkpoint")!());
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it("use: the delete-all confirmation starts it", async () => {
    updatePreferences({ historyStart: "use" });
    await mount();
    act(() => void getRegisteredHandler("history.deleteAll")!());
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it("changing the mode to open live starts it", async () => {
    updatePreferences({ historyStart: "use" });
    await mount();
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      updatePreferences({ historyStart: "open" });
    });
    await vi.waitFor(() => expect(repo.calls).toContain("configure"));
    expect(start).toHaveBeenCalledTimes(1);
  });
  it("use: a native start (history-started) configures and opens it here too", async () => {
    // Review #4: started natively (first save, outside fallback), the webview follows.
    updatePreferences({ historyStart: "use" });
    let notify: ((handle: string) => void) | null = null;
    (repo as any).onStarted = vi.fn(async (cb: (h: string) => void) => {
      notify = cb;
      return () => {};
    });
    await mount();
    expect(repo.calls).not.toContain("configure");
    await act(async () => {
      notify?.("another-vault");
    });
    expect(repo.calls).not.toContain("configure");
    await act(async () => {
      notify?.(H);
    });
    expect(repo.calls).toContain("configure");
    expect(repo.calls).toContain("opened");
  });
});
