import { IconClose } from "./Icons";

import "./feedback.css";

interface BannerProps {
  message: string;
  kind: "error" | "info" | "warning";
  onDismiss: () => void;
  dismissLabel: string;
  testId?: string;
  /** Extra hook class (e2e / legacy selectors). */
  className?: string;
  /** One text button beside the message (for example "Save a copy"). */
  action?: { label: string; onClick: () => void; testId?: string };
}

/** A 32 px strip at the top of the canvas; never modal. */
export const Banner = ({
  message,
  kind,
  onDismiss,
  dismissLabel,
  testId,
  className,
  action,
}: BannerProps) => (
  <div
    className={`vault-global-alert vd-banner vd-banner--${kind}${
      className ? ` ${className}` : ""
    }`}
    role="alert"
    data-testid={testId}
  >
    <span className="vd-banner__text" title={message}>
      {message}
    </span>
    {action && (
      <button
        type="button"
        className="vault-btn vault-btn--ghost vd-banner__action"
        onClick={action.onClick}
        data-testid={action.testId}
      >
        {action.label}
      </button>
    )}
    <button
      type="button"
      className="vault-btn vault-btn--ghost vault-btn--icon vd-banner__close"
      onClick={onDismiss}
      aria-label={dismissLabel}
    >
      <IconClose />
    </button>
  </div>
);
