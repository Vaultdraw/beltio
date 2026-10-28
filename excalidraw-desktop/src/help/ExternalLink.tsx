import { openExternal } from "./openExternal";

import type { MouseEvent, ReactNode } from "react";

interface Props {
  href: string;
  children: ReactNode;
  className?: string;
  /** Called when the browser could not be opened. */
  onError?: (message: string) => void;
}

/**
 * A link that opens in the default browser. A plain `<a target="_blank">` does
 * nothing inside the desktop webview, so every external link uses this.
 */
export const ExternalLink = ({ href, children, className, onError }: Props) => (
  <a
    href={href}
    rel="noreferrer"
    className={className}
    onClick={(e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void openExternal(href).catch(() =>
        onError?.("Couldn't open the link in the browser."),
      );
    }}
  >
    {children}
  </a>
);
