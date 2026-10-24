/** Typed wrappers for the native config check and doctor report (desktop only). */
import { nativeCall } from "./settingsSync";

export interface CheckReport {
  ok: boolean;
  errors: number;
  warnings: number;
  /** The human report, one problem per line plus a summary. */
  text: string;
  files: { file: string; path: string; status: "ok" | "missing" | "error" }[];
  problems: {
    file: string;
    path: string;
    line: number | null;
    column: number | null;
    key: string | null;
    severity: "error" | "warning";
    message: string;
  }[];
}

export interface DoctorReport {
  /** The multi-line report `vaultdraw doctor` prints. */
  text: string;
  report: Record<string, unknown>;
}

export const checkConfig = () =>
  nativeCall<CheckReport>("Config check", "config_check");

export const doctorReport = () =>
  nativeCall<DoctorReport>("Debug info", "doctor_report");
