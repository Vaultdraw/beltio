/**
 * Tag grammar, a port of src-tauri/src/search/tags.rs (keep them in sync).
 * A tag is `#word` in a text element or frame name; offsets are UTF-16.
 */
import { foldKey } from "../search/foldKey";

export {
  findTags,
  MAX_TAG_CHARS,
  OPENERS,
  TAG_BODY_CHAR,
  TAG_START,
  type TagMatch,
} from "../../../sdk/api/shared/tagGrammar";

/** Case/accent-folded key, the same fold as the search index (one table pins both). */
export const tagKey = (display: string) => foldKey(display);

/** True when `key` equals `filter` or lives under it (`dsa/graphs` under `dsa`). */
export const keyUnder = (key: string, filter: string) =>
  key === filter || key.startsWith(`${filter}/`);
