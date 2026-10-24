import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";

import { GitNotice } from "./GitNotice";
import { HISTORY_COMMAND_IDS as I } from "./historyCommands";

import type { HistoryStatus } from "./types";

const gitVault = { gitRepo: true, gitExcluded: false } as HistoryStatus;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("GitNotice: history.dismissGitNotice", () => {
  it("is bound only while the notice shows, and runs Not now", () => {
    const { rerender, unmount } = render(
      <GitNotice status={gitVault} vaultKey="vault-a" onExclude={() => {}} />,
    );
    const dismiss = getRegisteredHandler(I.dismissGitNotice);
    expect(dismiss).toBeTypeOf("function");

    act(() => dismiss!());
    expect(getRegisteredHandler(I.dismissGitNotice)).toBeUndefined();

    rerender(
      <GitNotice status={gitVault} vaultKey="vault-a" onExclude={() => {}} />,
    );
    expect(getRegisteredHandler(I.dismissGitNotice)).toBeUndefined();
    unmount();
  });

  it("is not bound when the vault is not a git repo", () => {
    const { unmount } = render(
      <GitNotice
        status={{ gitRepo: false } as HistoryStatus}
        vaultKey="vault-b"
        onExclude={() => {}}
      />,
    );
    expect(getRegisteredHandler(I.dismissGitNotice)).toBeUndefined();
    unmount();
  });
});
