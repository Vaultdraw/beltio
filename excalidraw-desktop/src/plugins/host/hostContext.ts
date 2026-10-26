/** `ctx.host`: app version, API level and revision, and `has(feature)`. */
import { API_REVISION, FEATURES } from "../../../../sdk/api/shared/features";
import { APP_VERSION } from "../../appVersion";

import type { HostApi } from "../api";

/** True for the names of the generated feature table (own keys only). */
export const hasFeature = (name: string): boolean =>
  typeof name === "string" && Object.hasOwn(FEATURES, name);

export const createHostApi = (): HostApi =>
  Object.freeze({
    app: APP_VERSION,
    api: Object.freeze({ level: 0 as const, revision: API_REVISION }),
    has: hasFeature,
  });
