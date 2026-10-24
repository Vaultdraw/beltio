import { useEffect, useRef, useState } from "react";

import { Dialog } from "./Dialog";

import "./reportDialog.css";

interface ReportDialogProps {
  title: string;
  text: string;
  tone: "ok" | "warning" | "error";
  onClose: () => void;
}

/** A read-only text report with Copy and Close (config check, debug info). */
export const ReportDialog = ({
  title,
  text,
  tone,
  onClose,
}: ReportDialogProps) => {
  const [status, setStatus] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch {
      setStatus("Could not copy");
    }
  };

  return (
    <Dialog
      title={title}
      titleId="report-dialog-title"
      onClose={onClose}
      className="vd-dialog--wide"
      testId="report-dialog"
      footer={
        <>
          <span className="vd-report__status" role="status">
            {status}
          </span>
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            onClick={() => void copy()}
          >
            Copy
          </button>
          <button
            ref={closeRef}
            type="button"
            className="vault-btn vault-btn--sm"
            onClick={onClose}
          >
            Close
          </button>
        </>
      }
    >
      <pre className="vd-report__text" data-tone={tone} tabIndex={0}>
        {text}
      </pre>
    </Dialog>
  );
};
