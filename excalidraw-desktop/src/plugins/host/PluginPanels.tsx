/** Mounts the panels plugins declared; a panel's code loads when it first opens. */
import { Component, useCallback, useSyncExternalStore } from "react";

import type { ComponentType, ReactNode } from "react";

import { PanelHost } from "../../slots/PanelHost";
import { closePanel, usePanelOpen } from "../../slots/panelStore";

import { reportPluginError } from "./errors";
import {
  getPluginPanels,
  subscribePluginPanels,
  type PluginPanelStub,
} from "./panelRegistry";

import "./pluginPanels.css";

/** Attributes a render error of a plugin component to the plugin. */
class PluginBoundary extends Component<
  { pluginId: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportPluginError(this.props.pluginId, error, "panel render");
  }
  render() {
    return this.state.failed ? (
      <div className="vault-panel-error" role="alert">
        This plugin panel crashed.
      </div>
    ) : (
      this.props.children
    );
  }
}

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

function PluginPanel({ stub }: { stub: PluginPanelStub }) {
  const open = usePanelOpen(stub.id);
  const onClose = useCallback(() => closePanel(stub.id), [stub.id]);
  if (!open) {
    return null;
  }
  return (
    <aside
      className="vault-plugin-panel"
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
  );
}

export function PluginPanels() {
  const panels = useSyncExternalStore(
    subscribePluginPanels,
    getPluginPanels,
    getPluginPanels,
  );
  return (
    <>
      {panels.map((stub) => (
        <PluginPanel key={stub.id} stub={stub} />
      ))}
    </>
  );
}
