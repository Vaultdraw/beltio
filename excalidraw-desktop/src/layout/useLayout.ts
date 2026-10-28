/**
 * The window's layout: which parts show, given the base switches, the
 * active preset and hand toggles. Binds the layout commands and registers a
 * `layout.preset.<name>` command per user preset.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { defineContextKey } from "../commands/contextKeys";
import { registerCommands } from "../commands/registry";
import {
  registerCommandHandlers,
  registerCommandPrefixHandler,
} from "../commands/handlerRegistry";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

import {
  FOCUS_CONTEXT_KEY,
  LAYOUT_COMMAND_IDS,
  LAYOUT_PRESET_PREFIX,
  presetCommand,
} from "./layoutCommands";
import {
  allPresets,
  BUILTIN_PRESETS,
  FOCUS_PRESET,
  shownParts,
  type LayoutPart,
  type ShownParts,
} from "./layoutSettings";
import {
  getLayoutState,
  setActivePreset,
  setSessionPart,
  subscribeLayout,
  togglePreset,
} from "./layoutStore";

export interface LayoutBase {
  navigator: boolean;
  activity_bar: boolean;
  tab_strip: boolean;
  status_bar: boolean;
}

export interface Layout {
  shown: ShownParts;
  /**
   * When the active preset (or a hand toggle) governs `part`, flip it for
   * this session and return true; otherwise the caller writes its own
   * setting as before.
   */
  toggleGoverned: (part: LayoutPart) => boolean;
  /** Show `part` for this session if the active preset hides it. */
  reveal: (part: LayoutPart) => void;
  /** Focus mode is on. */
  focusActive: boolean;
}

export function useLayout(
  win: Window | null,
  base: LayoutBase,
  notify: (message: string) => void,
): Layout {
  const prefs = useSyncExternalStore(subscribePreferences, () =>
    getPreferences(win),
  );
  const state = useSyncExternalStore(subscribeLayout, getLayoutState);
  const {
    layoutHeader,
    layoutFooter,
    layoutPreset,
    layoutPresets,
    focusHide,
    focusRemember,
    focusOn,
  } = prefs;
  const presets = useMemo(
    () => allPresets(layoutPresets, focusHide),
    [layoutPresets, focusHide],
  );

  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // `layout.preset` applies at launch and whenever its value changes; with
  // `focus.remember`, a launch without one reopens in focus mode if it was on.
  const launching = useRef(true);
  const rememberedFocus = useRef(focusRemember && focusOn);
  useEffect(() => {
    const preset =
      layoutPreset ||
      (launching.current && rememberedFocus.current ? FOCUS_PRESET : "");
    launching.current = false;
    if (preset === "") {
      setActivePreset(null);
    } else if (presets[preset]) {
      setActivePreset(preset);
    } else {
      setActivePreset(null);
      notifyRef.current(`Unknown layout preset "${preset}"`);
    }
    // Only the value: editing a preset's table keeps the session choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutPreset]);

  // `focus.remember`: keep "focus mode is on" for the next launch.
  const rememberRef = useRef({ focusRemember, focusOn });
  rememberRef.current = { focusRemember, focusOn };
  useEffect(
    () =>
      subscribeLayout(() => {
        const now = getLayoutState().preset === FOCUS_PRESET;
        const mem = rememberRef.current;
        if (mem.focusRemember && mem.focusOn !== now) {
          updatePreferences({ focusOn: now }, win);
        }
      }),
    [win],
  );

  // The key the Esc binding waits on; defined only while focus mode is on.
  const focusActive = state.preset === FOCUS_PRESET;
  useEffect(
    () =>
      focusActive ? defineContextKey(FOCUS_CONTEXT_KEY, () => true) : undefined,
    [focusActive],
  );

  // A preset that disappeared from the config can't stay active.
  useEffect(() => {
    if (state.preset && !presets[state.preset]) {
      setActivePreset(null);
    }
  }, [presets, state.preset]);

  // One command per user preset (built-in ones are in commands.ts).
  const userNames = useMemo(
    () => Object.keys(layoutPresets).filter((n) => !BUILTIN_PRESETS[n]),
    [layoutPresets],
  );
  useEffect(
    () =>
      userNames.length > 0
        ? registerCommands(userNames.map(presetCommand))
        : undefined,
    [userNames],
  );

  const shown = useMemo(
    () =>
      shownParts(
        {
          header: layoutHeader,
          footer: layoutFooter,
          navigator: base.navigator,
          activity_bar: base.activity_bar,
          tab_strip: base.tab_strip,
          status_bar: base.status_bar,
        },
        state.preset ? presets[state.preset] ?? null : null,
        state.session,
      ),
    [
      layoutHeader,
      layoutFooter,
      base.navigator,
      base.activity_bar,
      base.tab_strip,
      base.status_bar,
      state,
      presets,
    ],
  );

  const live = useRef({ shown, presets });
  live.current = { shown, presets };

  const toggleGoverned = useCallback((part: LayoutPart): boolean => {
    const { preset, session } = getLayoutState();
    const governed =
      session[part] !== undefined ||
      (preset !== null && live.current.presets[preset]?.[part] !== undefined);
    if (governed) {
      setSessionPart(part, !live.current.shown[part]);
    }
    return governed;
  }, []);

  const reveal = useCallback((part: LayoutPart) => {
    if (!live.current.shown[part] && getLayoutState().preset !== null) {
      setSessionPart(part, true);
    }
  }, []);

  useEffect(() => {
    const unbindPresets = registerCommandPrefixHandler(
      LAYOUT_PRESET_PREFIX,
      (name) => {
        if (live.current.presets[name]) {
          togglePreset(name);
        }
      },
    );
    const unbind = registerCommandHandlers({
      [LAYOUT_COMMAND_IDS.toggleFocus]: () => {
        if (live.current.presets[FOCUS_PRESET]) {
          togglePreset(FOCUS_PRESET);
        }
      },
      [LAYOUT_COMMAND_IDS.exitFocus]: () => {
        if (getLayoutState().preset === FOCUS_PRESET) {
          setActivePreset(null);
        }
      },
      [LAYOUT_COMMAND_IDS.reset]: () => setActivePreset(null),
      [LAYOUT_COMMAND_IDS.toggleHeader]: () => {
        if (!toggleGoverned("header")) {
          updatePreferences({ layoutHeader: !live.current.shown.header }, win);
        }
      },
      [LAYOUT_COMMAND_IDS.toggleFooter]: () => {
        if (!toggleGoverned("footer")) {
          updatePreferences({ layoutFooter: !live.current.shown.footer }, win);
        }
      },
    });
    return () => {
      unbindPresets();
      unbind();
    };
  }, [win, toggleGoverned]);

  return { shown, toggleGoverned, reveal, focusActive };
}
