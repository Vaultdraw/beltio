/**
 * `ctx.network` of the mock host: a list of pictures by address, the user's "web pictures" setting
 * (on unless turned off), and the permission `network.images` checked first. Nothing goes on the wire.
 */
import { PluginApiError } from "../shared/rules";
import { permissionError } from "../shared/vaultPaths";

import type { NetworkApi } from "@vaultdraw/api";

export interface FakeNetwork {
  /** Pictures by address (bytes), or an error code to reject with (`"NOT_AN_IMAGE"`, `"HTTP_STATUS"`, ...). */
  images: Record<string, Uint8Array | string>;
  /** The user's setting: false when web pictures are turned off (or the network is off). */
  allowed: boolean;
  /** The address lists `askImages` was called with. */
  asked: string[][];
  /** Addresses `fetchImage` was called with, in order. */
  fetched: string[];
}

export function createNetworkModel() {
  const fake: FakeNetwork = {
    images: {},
    allowed: true,
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
          fake.asked.push([...urls]);
          return fake.allowed;
        },
        async fetchImage(url) {
          need("network.fetchImage");
          if (!fake.allowed) {
            throw new PluginApiError(
              "NETWORK_NOT_ALLOWED",
              "Downloading pictures from web pages is turned off in Settings.",
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
      fake.allowed = true;
      fake.asked = [];
      fake.fetched = [];
    },
  };
}
