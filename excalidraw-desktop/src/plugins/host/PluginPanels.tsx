/** Mounts the panels plugins declared; a panel's code loads when it first opens. */
import { useCallback, useSyncExternalStore } from "react";

import { useNavigatorOverlay } from "../../layout/useNavigatorOverlay";
import { PanelHost } from "../../slots/PanelHost";
import { closePanel, usePanelOpen } from "../../slots/panelStore";

import { PluginBoundary } from "./PluginBoundary";
import {
  getPluginPanels,
  subscribePluginPanels,
  type PluginPanelStub,
} from "./panelRegistry";

import "./pluginPanels.css";

import type { ComponentType } from "react";

// Shares this chunk: the status bar loads with the panel host, and draws nothing until an item has text.
export { PluginStatusBar } from "./PluginStatusBar";

const wrapped = new WeakMap<ComponentType, ComponentType>();

const withBoundary = (pluginId: string, C: ComponentType): ComponentType => {
  let W = wrapped.get(C);
  if (!W) {
    W = () => (
      <PluginBoundary pluginId={pluginId}>
        <C />
      </PluginBoundary>
    );
    wrapped.set(C, W);
  }
  return W;
};

const loaders = new WeakMap<PluginPanelStub, PluginPanelStub["load"]>();
const boundaryLoad = (stub: PluginPanelStub) => {
  let load = loaders.get(stub);
  if (!load) {
    load = async () => {
      const { default: C } = await stub.load();
      return { default: withBoundary(stub.pluginId, C) };
    };
    loaders.set(stub, load);
  }
  return load;
};

function PluginPanel({
  stub,
  narrow,
}: {
  stub: PluginPanelStub;
  narrow: boolean;
}) {
  const open = usePanelOpen(stub.id);
  const onClose = useCallback(() => closePanel(stub.id), [stub.id]);
  // In a narrow window the panel floats over the drawing like the file list: Esc and a click on
  // the strip of drawing beside it close it (toimprove 285; Obsidian's right drawer).
  useNavigatorOverlay(
    narrow && open ? document : null,
    narrow && open,
    onClose,
    null,
  );
  if (!open) {
    return null;
  }
  return (
    <>
      {narrow && (
        <div
          className="vault-navigator-scrim"
          data-testid={`plugin-panel-scrim-${stub.id}`}
          onPointerDown={onClose}
        />
      )}
      <aside
        className={`vault-plugin-panel${
          narrow ? " vault-plugin-panel--overlay" : ""
        }`}
        data-testid={`plugin-panel-${stub.id}`}
        aria-label={stub.title}
      >
        <PanelHost
          id={stub.id}
          load={boundaryLoad(stub)}
          open
          onClose={onClose}
          props={{}}
        />
      </aside>
    </>
  );
}

export function PluginPanels({ narrow = false }: { narrow?: boolean }) {
  const panels = useSyncExternalStore(
    subscribePluginPanels,
    getPluginPanels,
    getPluginPanels,
  );
  return (
    <>
      {panels.map((stub) => (
        <PluginPanel key={stub.id} stub={stub} narrow={narrow} />
      ))}
    </>
  );
}
