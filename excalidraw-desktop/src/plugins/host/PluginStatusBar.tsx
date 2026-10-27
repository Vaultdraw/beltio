/** The status bar plugins fill. Renders nothing while no item has text or the user turned it off. */
import { useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "../../vault/preferences";
import { toastStore } from "../../toasts/toastStore";

import { errorText } from "./errors";
import { runCommandById } from "./runner";
import {
  getStatusItems,
  subscribeStatusItems,
  type StatusItem,
} from "./statusBarRegistry";

import "./pluginStatusBar.css";

const useBarEnabled = (win: Window) =>
  useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win).pluginsStatusBar,
  );

const click = (item: StatusItem) => {
  if (item.command) {
    runCommandById(item.command).catch((err) =>
      toastStore.push({
        message: `${item.pluginName}: ${errorText(err)}`,
        kind: "error",
      }),
    );
  }
};

function Item({ item }: { item: StatusItem }) {
  const tip = item.tooltip ?? item.title;
  const common = {
    className: `vault-status-item vault-status-item--${item.tone}`,
    title: `${tip} (${item.pluginName})`,
    "data-testid": `plugin-status-${item.key}`,
  };
  return item.command ? (
    <button type="button" {...common} onClick={() => click(item)}>
      {item.text}
    </button>
  ) : (
    <span {...common}>{item.text}</span>
  );
}

export function PluginStatusBar({ win }: { win: Window }) {
  const enabled = useBarEnabled(win);
  const items = useSyncExternalStore(subscribeStatusItems, getStatusItems);
  if (!enabled || items.length === 0) {
    return null;
  }
  return (
    <div
      className="vault-status-bar"
      role="status"
      aria-label="Plugin status"
      data-testid="plugin-status-bar"
    >
      <div className="vault-status-side">
        {items
          .filter((i) => i.align === "left")
          .map((i) => (
            <Item key={i.key} item={i} />
          ))}
      </div>
      <div className="vault-status-side">
        {items
          .filter((i) => i.align === "right")
          .map((i) => (
            <Item key={i.key} item={i} />
          ))}
      </div>
    </div>
  );
}
