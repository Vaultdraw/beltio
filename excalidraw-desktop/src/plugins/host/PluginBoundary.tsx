/** Attributes a render error of a plugin component to the plugin and shows a message instead. */
import { Component } from "react";

import { reportPluginError } from "./errors";

import type { ReactNode } from "react";

/** `what` names the surface in the message and the error log: "panel" (default) or "view". */
export class PluginBoundary extends Component<
  { pluginId: string; what?: "panel" | "view"; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportPluginError(
      this.props.pluginId,
      error,
      `${this.props.what ?? "panel"} render`,
    );
  }
  render() {
    return this.state.failed ? (
      <div className="vault-panel-error" role="alert">
        This plugin {this.props.what ?? "panel"} crashed.
      </div>
    ) : (
      this.props.children
    );
  }
}
