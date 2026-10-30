import clsx from "clsx";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { KEYS } from "@excalidraw/common";

import { useCreatePortalContainer } from "../hooks/useCreatePortalContainer";

import "./Modal.scss";

import type { AppState } from "../types";

export const Modal: React.FC<{
  className?: string;
  children: React.ReactNode;
  maxWidth?: number;
  onCloseRequest(): void;
  labelledBy: string;
  theme?: AppState["theme"];
  closeOnClickOutside?: boolean;
}> = (props) => {
  const { closeOnClickOutside = true } = props;
  const modalRoot = useCreatePortalContainer({
    className: "excalidraw-modal-container",
  });

  const animationsDisabled = useMemo(
    () =>
      modalRoot?.ownerDocument.body.classList.contains(
        "excalidraw-animations-disabled",
      ) ?? false,
    [modalRoot],
  );

  // A click on a button inside the dialog can leave focus on <body> (the button is disabled while
  // it works, as in the image export on Linux WebKitGTK), and a key pressed there never reaches
  // the dialog. Escape on the page body closes the topmost dialog, as with focus inside it.
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onCloseRequest);
  onCloseRef.current = props.onCloseRequest;
  const doc = modalRoot?.ownerDocument;
  useEffect(() => {
    if (!doc) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const el = modalRef.current;
      if (
        event.key !== KEYS.ESCAPE ||
        event.defaultPrevented ||
        !el ||
        (event.target !== doc.body && event.target !== doc.documentElement)
      ) {
        return;
      }
      const dialogs = doc.querySelectorAll(".Modal");
      if (dialogs[dialogs.length - 1] !== el) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [doc]);

  if (!modalRoot) {
    return null;
  }

  const handleKeydown = (event: React.KeyboardEvent) => {
    if (event.key === KEYS.ESCAPE) {
      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      event.stopPropagation();
      props.onCloseRequest();
    }
  };

  return createPortal(
    <div
      className={clsx("Modal", props.className, {
        "animations-disabled": animationsDisabled,
      })}
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeydown}
      aria-labelledby={props.labelledBy}
    >
      <div
        className="Modal__background"
        onClick={closeOnClickOutside ? props.onCloseRequest : undefined}
      />
      <div
        className="Modal__content"
        style={{ "--max-width": `${props.maxWidth}px` }}
        tabIndex={0}
      >
        {props.children}
      </div>
    </div>,
    modalRoot,
  );
};
