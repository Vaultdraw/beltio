import { lazy, Suspense, useSyncExternalStore } from "react";

import {
  closeReport,
  getReport,
  subscribeReport,
} from "../commands/configCommands";

// The dialog code loads on first use: nothing at startup.
const ReportDialog = lazy(() =>
  import("./ReportDialog").then((m) => ({ default: m.ReportDialog })),
);

/** Renders the report dialog (config check, debug info) when one is open. */
export const ReportDialogHost = () => {
  const report = useSyncExternalStore(subscribeReport, getReport);
  if (!report) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <ReportDialog
        title={report.title}
        text={report.text}
        tone={report.tone}
        onClose={closeReport}
      />
    </Suspense>
  );
};
