import { SHARED_MODULES, shimUrl } from "./specifiers";

/**
 * Exact text of the inline `<script type="importmap">`. The CSP carries the
 * sha256 of this string, so it must stay compact, LF-only and deterministic.
 */
export const importMapText = (): string =>
  JSON.stringify({
    imports: Object.fromEntries(
      SHARED_MODULES.map(({ specifier }) => [specifier, shimUrl(specifier)]),
    ),
  });

export const importMapScriptTag = (): string =>
  `<script type="importmap">${importMapText()}</script>`;
