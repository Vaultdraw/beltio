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
  } as unknown as PluginInfo);

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
    expect(
      pluginsWaitingForReview(infos, ["a", "b", "d"]).map((i) => i.id),
    ).toEqual(["a"]);
  });

  it("says nothing when no plugin waits, and once per launch otherwise", () => {
    const l = (plugins: PluginInfo[], extra: object = {}) => ({
      plugins,
      errors: [],
      ...extra,
    });
    expect(noticePluginsWaitingForReview(l([info("a", "ok")]), ["a"])).toBe(
      false,
    );
    const infos = [info("a", "review"), info("b", "review")];
    expect(noticePluginsWaitingForReview(l(infos), ["a", "b"])).toBe(true);
    expect(noticePluginsWaitingForReview(l(infos), ["a", "b"])).toBe(false);
  });

  it("names refused official ids and a moved-aside consent file, and caps the list at three names", () => {
    const four = ["a", "b", "c", "d"].map((x) => info(x, "review"));
    expect(
      noticePluginsWaitingForReview(
        {
          plugins: four,
          errors: [
            {
              dir: "/p/graph",
              message: "'graph' is an official plugin id. Choose another",
            },
            { dir: "/p/x", message: "bad manifest" },
          ],
          consentReset: true,
        },
        ["a", "b", "c", "d"],
      ),
    ).toBe(true);
    const text = toastStore
      .getSnapshot()
      .toasts.map((t) => t.message)
      .join("");
    expect(text).toContain("moved aside");
    expect(text).toContain("A, B, C and 1 more");
    expect(text).toContain("refused for reusing an official plugin id: graph");
  });
});
