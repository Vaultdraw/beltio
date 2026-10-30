// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { hydrateRemoteImages } from "./hydrate";
import { sanitizeNoteHtml } from "./sanitize";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
let n = 0;
const page = (remote: boolean) => {
  n += 1;
  const root = document.createElement("div");
  document.body.append(root);
  root.innerHTML = sanitizeNoteHtml(
    `<img src="https://example.com/p${n}.png" alt="a pic">`,
    { remoteImages: remote },
  );
  return root;
};

describe("web pictures in the reading view (toimprove 161)", () => {
  it("allowed: the picture is fetched through the checked download and shown", async () => {
    URL.createObjectURL = vi.fn(() => "blob:test/1");
    URL.revokeObjectURL = vi.fn();
    const fetch = vi.fn(async () => PNG);
    const root = page(true);
    await hydrateRemoteImages(root, fetch);
    expect(fetch).toHaveBeenCalledWith("https://example.com/p1.png");
    expect(root.querySelector("img")!.getAttribute("src")).toBe("blob:test/1");
  });

  it("refused or failed: the alt text stays, no broken image", async () => {
    const root = page(true);
    await hydrateRemoteImages(root, async () => {
      throw new Error("NETWORK_DISABLED");
    });
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toBe("a pic");
  });

  it("off (setting or Offline mode): nothing to fetch, the alt text shows", async () => {
    const fetch = vi.fn(async () => PNG);
    const root = page(false);
    await hydrateRemoteImages(root, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(root.textContent).toBe("a pic");
  });
});
