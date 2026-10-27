/** Renders the open plugin overlay over the drawing area. Lazy: loaded when the first overlay opens. */
import { useEffect, useRef, useSyncExternalStore } from "react";

import { PluginBoundary } from "./host/PluginBoundary";
import { closeOverlay, getOverlay, subscribeOverlay } from "./overlayStore";

const STYLE = {
  position: "absolute",
  inset: 0,
  zIndex: 5,
  background: "var(--vault-bg, #fff)",
} as const;

export default function PluginOverlayHost({
  onClosed,
}: {
  /** Called after the overlay closed: give focus back to the canvas. */
  onClosed: () => void;
}) {
  const entry = useSyncExternalStore(subscribeOverlay, getOverlay);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  // The shell unmounts this host when the overlay closes, however it closed.
  useEffect(() => () => closed.current(), []);
  if (!entry) {
    return null;
  }
  const { Component } = entry;
  const close = () => closeOverlay(entry);
  return (
    <div
      className="vd-plugin-overlay"
      style={STYLE}
      data-plugin-overlay={entry.pluginId}
    >
      <PluginBoundary pluginId={entry.pluginId} what="overlay">
        <Component close={close} />
      </PluginBoundary>
    </div>
  );
}
