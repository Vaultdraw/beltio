import { beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "../../toasts/toastStore";

import {
  noticePluginsWaitingForReview,
  pluginsWaitingForReview,
  resetReviewNotice,
} from "./reviewNotice";

import type { PluginInfo } from "./types";

const info = (id: string, state: string, extra: object = {}): PluginInfo =>
  ({
    id,
    name: id.toUpperCase(),
    compatible: true,
    hostDisabled: false,
    review: { state, added: [] },
    ...extra,
  }) as unknown as PluginInfo;

describe("plugins waiting for review: startup notice", () => {
  beforeEach(() => {
    resetReviewNotice();
    toastStore.clear?.();
  });

  it("lists only enabled, compatible plugins that need review", () => {
    const infos = [
      info("a", "review"),
      info("b", "ok"),
      info("c", "review"),
      info("d", "review", { compatible: false }),
    ];
    expect(pluginsWaitingForReview(infos, ["a", "b", "d"]).map((i) => i.id)).toEqual(["a"]);
  });

  it("says nothing when no plugin waits, and once per launch otherwise", () => {
    expect(noticePluginsWaitingForReview([info("a", "ok")], ["a"])).toBe(false);
    const infos = [info("a", "review"), info("b", "review")];
    expect(noticePluginsWaitingForReview(infos, ["a", "b"])).toBe(true);
    expect(noticePluginsWaitingForReview(infos, ["a", "b"])).toBe(false);
  });
});
