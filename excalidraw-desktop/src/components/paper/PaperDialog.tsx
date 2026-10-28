import { useEffect, useRef } from "react";

import {
  getDefaultBackgroundPattern,
  setDefaultBackgroundPattern,
} from "../../vault/paperDefaults";
import { Dialog } from "../Dialog";

import { PaperControls } from "./PaperControls";
import { PaperPreview } from "./PaperPreview";
import { usePaperPattern } from "./usePaperPattern";

import "./paper.css";

type Props = { onClose: () => void; ownerDocument?: Document | null };

/** Per-drawing paper settings. Render inside the Excalidraw tree. */
export const PaperDialog = ({ onClose }: Props) => {
  const { pattern, setPattern, readOnly, theme } = usePaperPattern();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(".vd-dialog__close")?.focus();
  }, [readOnly]);

  if (readOnly) {
    return null;
  }
  return (
    <Dialog
      title="Paper settings"
      titleId="paper-dialog-title"
      onClose={onClose}
      className="paper-dialog"
      frameRef={dialogRef}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            onClick={() => setPattern(getDefaultBackgroundPattern())}
          >
            Use app default
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={() => setDefaultBackgroundPattern(pattern)}
          >
            Make app default
          </button>
        </>
      }
    >
      <div className="paper-dialog__body">
        <PaperPreview pattern={pattern} theme={theme} />
        <PaperControls
          value={pattern}
          onChange={setPattern}
          canvasTheme={theme}
        />
      </div>
    </Dialog>
  );
};
