/** The strip of plugin buttons over the canvas. Renders nothing without a button or when turned off. */
import { useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "../vault/preferences";

import {
  getToolbarButtons,
  runToolbarButton,
  subscribeToolbarButtons,
} from "./toolbarRegistry";

import "./pluginToolbar.css";

export function PluginToolbar({ win }: { win: Window }) {
  const enabled = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win).pluginsToolbar,
  );
  const buttons = useSyncExternalStore(
    subscribeToolbarButtons,
    getToolbarButtons,
  );
  if (!enabled || buttons.length === 0) {
    return null;
  }
  return (
    <div
      className="plugin-toolbar"
      role="toolbar"
      aria-label="Plugin tools"
      data-testid="plugin-toolbar"
    >
      {buttons.map((b) => (
        <button
          key={b.command}
          type="button"
          className="plugin-toolbar__button"
          aria-label={b.title}
          title={`${b.title} (${b.pluginName})`}
          data-testid={`plugin-toolbar-${b.command}`}
          onClick={() => runToolbarButton(b)}
        >
          {b.icon ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d={b.icon}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <span aria-hidden="true">{b.title.trim().charAt(0)}</span>
          )}
        </button>
      ))}
    </div>
  );
}
