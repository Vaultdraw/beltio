/**
 * The import report: a note written into the new vault when something did not import cleanly.
 * It lists failed files with the reason, and the images that stayed boxes, grouped by reason.
 * Nothing is written for a clean import.
 */
import type { ImageIssue, ObsidianImportResult } from "./types";

/** Where the report lands (the vault root; a taken name gets the next free one). */
export const REPORT_PATH = "Import report.excalidraw";

const REASONS: Record<ImageIssue["reason"], string> = {
  missing: "Image file not found in the vault",
  oversized: "Image over 4 MB (the file is copied, the drawing shows a box)",
  unsupported: "Image type a drawing cannot hold (the file is copied)",
};

const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

/** The report as Markdown, or null when there is nothing to report. */
export function buildReport(
  sourceName: string,
  r: ObsidianImportResult,
): string | null {
  const total = r.imageIssues.length;
  if (r.errors.length === 0 && total === 0) {
    return null;
  }
  const lines: string[] = [`# Import report: ${sourceName}`, ""];
  lines.push(
    `${r.notes} notes and ${r.drawings} drawings written, ${r.attachments} attachments copied.`,
    "",
  );
  if (r.errors.length > 0) {
    lines.push(`## Files that failed (${r.errors.length})`, "");
    for (const e of r.errors) {
      lines.push(`- ${code(e.path)}: ${e.message.replace(/\s+/g, " ")}`);
    }
    lines.push("");
  }
  for (const reason of ["missing", "oversized", "unsupported"] as const) {
    const rows = r.imageIssues.filter((i) => i.reason === reason);
    if (rows.length === 0) {
      continue;
    }
    lines.push(`## ${REASONS[reason]} (${rows.length})`, "");
    for (const i of rows) {
      lines.push(`- ${code(i.note)}: ${code(i.image)}`);
    }
    lines.push("");
  }
  const counted = r.oversizedImages + r.unsupportedImages + r.missingImages;
  if (counted > total) {
    lines.push(`${counted - total} more images are not listed.`, "");
  }
  return lines.join("\n");
}
