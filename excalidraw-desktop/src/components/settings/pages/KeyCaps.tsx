import { formatChordParts } from "../../../commands/keys";
import { keyCapGroups } from "../../../palette/shortcuts";

import type { Chord, Platform } from "../../../commands/types";

/** Key caps of a stored key: one cap group per chord, groups spaced apart. */
export const KeyCaps = ({
  keyText,
  platform,
  leader,
}: {
  keyText: Chord;
  platform: Platform;
  /** Chord `<leader>` shows as; default is the built-in leader. */
  leader?: string;
}) => (
  <>
    {keyCapGroups(keyText, platform, formatChordParts, leader).map(
      (caps, g) => (
        <span key={g} className="vault-hotkeys__caps">
          {caps.map((part, i) => (
            <kbd key={i}>{part}</kbd>
          ))}
        </span>
      ),
    )}
  </>
);
