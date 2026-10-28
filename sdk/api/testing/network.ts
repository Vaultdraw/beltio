/**
 * `ctx.network` of the mock host: a list of pictures by address, an "allowed" switch the user's
 * dialog would set, and the permission `network.images` checked first. Nothing goes on the wire.
 */
import { PluginApiError } from "../shared/rules";
import { permissionError } from "../shared/vaultPaths";

import type { NetworkApi } from "../src/index";

export interface FakeNetwork {
  /** Pictures by address (bytes), or an error code to reject with (`"NOT_AN_IMAGE"`, `"HTTP_STATUS"`, ...). */
  images: Record<string, Uint8Array | string>;
  /** What the user answers in the consent dialog the next time it shows. */
  answer: boolean;
  /** True once the user allowed downloads (a later `askImages` does not ask again). */
  allowed: boolean;
  /** The address lists `askImages` was called with (only the calls that showed the dialog). */
  asked: string[][];
  /** Addresses `fetchImage` was called with, in order. */
  fetched: string[];
}

export function createNetworkModel() {
  const fake: FakeNetwork = {
    images: {},
    answer: true,
    allowed: false,
    asked: [],
    fetched: [],
  };
  return {
    fake,
    api(id: string, permissions: readonly string[]): NetworkApi {
      const need = (method: string) => {
        if (!permissions.includes("network.images")) {
          throw permissionError(id, method, "network.images");
        }
      };
      return {
        async askImages(urls) {
          need("network.askImages");
          if (fake.allowed) {
            return true;
          }
          fake.asked.push([...urls]);
          fake.allowed = fake.answer;
          return fake.allowed;
        },
        async fetchImage(url) {
          need("network.fetchImage");
          if (!fake.allowed) {
            throw new PluginApiError(
              "NETWORK_NOT_ALLOWED",
              "Downloading pictures from web pages is not allowed. You can allow it in Settings.",
            );
          }
          fake.fetched.push(url);
          const hit = fake.images[url];
          if (hit === undefined) {
            throw new PluginApiError("NETWORK_ERROR", "Request failed");
          }
          if (typeof hit === "string") {
            throw new PluginApiError(hit, hit);
          }
          return hit;
        },
      };
    },
    reset() {
      fake.images = {};
      fake.answer = true;
      fake.allowed = false;
      fake.asked = [];
      fake.fetched = [];
    },
  };
}
