/** The plugin API levels this app loads: 1 (API 1.0) and the pre-1.0 level 0, which loads with a warning until 2.0. */
export const SUPPORTED_API_LEVELS: readonly number[] = [1, 0];

export const isSupportedApi = (level: number): boolean =>
  SUPPORTED_API_LEVELS.includes(level);
