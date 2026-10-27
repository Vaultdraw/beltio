/** `ctx.thumbnails`: hooks over the app's one thumbnail service (no cache of its own). */
import {
  useThumbnail,
  useThumbnailService,
} from "../../thumbnails/context";
import { useThumbDarkClass } from "../../thumbnails/surfaces/darkInvert";

import type { ThumbnailsApi } from "../api";

export function createThumbnailsApi(): ThumbnailsApi {
  return {
    use: (path, priority) => {
      const service = useThumbnailService();
      // A hook-order-stable call: the path is null when thumbnails are off.
      return useThumbnail(service ? path : null, priority);
    },
    useEnabled: () => {
      const service = useThumbnailService();
      return service !== null;
    },
    useDarkClass: useThumbDarkClass,
  };
}
