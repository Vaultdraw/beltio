/** `ctx.thumbnails`: hooks over the app's one thumbnail service (no cache of its own). */
import { useThumbnail, useThumbnailService } from "../../thumbnails/context";
import { useThumbDarkClass } from "../../thumbnails/surfaces/darkInvert";

import type { Priority } from "../../thumbnails/queue";
import type { ThumbnailState, ThumbnailsApi } from "../api";

const useThumbnailOf = (
  path: string | null,
  priority?: Priority,
): ThumbnailState => {
  const service = useThumbnailService();
  // The path is null when thumbnails are off, so the hook order stays the same.
  return useThumbnail(service ? path : null, priority);
};

const useThumbnailsEnabled = (): boolean => useThumbnailService() !== null;

export function createThumbnailsApi(): ThumbnailsApi {
  return {
    use: useThumbnailOf,
    useEnabled: useThumbnailsEnabled,
    useDarkClass: useThumbDarkClass,
  };
}
