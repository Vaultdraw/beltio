/**
 * The import dialog, shown as a plugin overlay: the file, the page range, the estimate, warnings,
 * and progress while it runs. A password prompt comes first for an encrypted PDF.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { estimateImport } from "./budget";
import { pdfErrorMessage } from "./errors";
import { sizeOf } from "./importPdf";
import { LIMITS, MAX_DRAWING_BYTES } from "./limits";
import { parsePageRange } from "./pageRange";

import type {
  PdfDocument,
  PdfImportSettings,
  PluginContext,
} from "@vaultdraw/api";
import type { PdfImportProgress } from "./importPdf";

const MB = 1024 * 1024;
const formatMb = (bytes: number) =>
  bytes >= 10 * MB
    ? `${Math.round(bytes / MB)} MB`
    : `${(bytes / MB).toFixed(1)} MB`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The frame: a modal card. Escape cancels (also while running), Tab stays inside. */
const Frame = ({
  titleId,
  onCancel,
  onSubmit,
  footer,
  children,
}: {
  titleId: string;
  onCancel: () => void;
  onSubmit: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const live = useRef(onCancel);
  live.current = onCancel;
  useEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        live.current();
      } else if (event.key === "Tab") {
        const items = [
          ...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
        ];
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const at = doc.activeElement;
        if (event.shiftKey && at === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && at === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return (
    <div className="pdfi" ref={root}>
      <form
        className="pdfi__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="pdf-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2 className="pdfi__title" id={titleId}>
          Import PDF
        </h2>
        {children}
        <div className="pdfi__footer">{footer}</div>
      </form>
    </div>
  );
};

const PasswordPrompt = ({
  doc,
  onUnlock,
  onCancel,
}: {
  doc: PdfDocument;
  onUnlock: (password: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const titleId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const submit = async () => {
    if (checking || password === "") {
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (err) {
      if (alive.current) {
        setError(pdfErrorMessage(err));
        setChecking(false);
        input.current?.focus();
        input.current?.select();
      }
    }
  };

  return (
    <Frame
      titleId={titleId}
      onCancel={onCancel}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="pdfi__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="pdfi__btn pdfi__btn--primary"
            disabled={checking || password === ""}
          >
            Unlock
          </button>
        </>
      }
    >
      <div className="pdfi__body">
        <div className="pdfi__file">
          <strong className="pdfi__name" title={doc.name}>
            {doc.name}
          </strong>
        </div>
        <div className="pdfi__status">
          This PDF is password-protected. Enter its password to import it.
        </div>
        <label className="pdfi__row">
          <span className="pdfi__label">Password</span>
          <input
            ref={input}
            autoFocus
            type="password"
            className="pdfi__input"
            value={password}
            disabled={checking}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== null}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="pdfi__status">
          {error && (
            <div className="pdfi__error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
};

const ImportOptions = ({
  ctx,
  doc,
  settings,
  progress,
  onImport,
  onCancel,
}: {
  ctx: Pick<PluginContext, "scene">;
  doc: PdfDocument;
  settings: PdfImportSettings;
  /** Non-null while the import runs. */
  progress: PdfImportProgress | null;
  onImport: (indices: number[]) => void;
  onCancel: () => void;
}) => {
  const titleId = useId();
  const statusId = useId();
  const [range, setRange] = useState("all");
  const running = progress !== null;

  // What the drawing looks like right now (the overlay freezes it, so it cannot change).
  const currentBytes = useMemo(() => ctx.scene.sizeBytes(), [ctx]);

  const parsed = useMemo(
    () => parsePageRange(range, doc.pageCount),
    [range, doc.pageCount],
  );
  const requested = useMemo(
    () => ("pages" in parsed ? parsed.pages : []),
    [parsed],
  );
  const plan = useMemo(
    () => ctx.scene.placePages(requested.map((i) => sizeOf(doc, i))),
    [ctx, doc, requested],
  );
  const pageMode = plan.pageCount !== null;
  const room = plan.maxPages ?? Infinity;
  const limit = Math.min(LIMITS.maxPages, room);
  const indices = useMemo(() => requested.slice(0, limit), [requested, limit]);

  const estimate = useMemo(
    () =>
      estimateImport({
        pages: doc.pages,
        indices,
        settings,
        currentBytes,
      }),
    [doc.pages, indices, settings, currentBytes],
  );

  let error: string | null = "error" in parsed ? parsed.error : null;
  if (!error && indices.length === 0) {
    error = pageMode ? "No room left for more pages" : "No pages selected";
  }

  const warnings: string[] = [];
  if (requested.length > limit) {
    warnings.push(
      pageMode && room < LIMITS.maxPages
        ? `Only ${limit} of ${
            requested.length
          } pages fit in page mode (${plural(
            plan.firstPage ?? 0,
            "page",
          )} already used)`
        : `Only ${limit} of ${requested.length} pages can be imported at once`,
    );
  }
  if (indices.length > settings.warnPages) {
    warnings.push(
      `${indices.length} pages is a lot: the drawing will be large and may feel slow`,
    );
  }
  if (!error && estimate.pagesThatFit < indices.length) {
    warnings.push(
      `Only ${estimate.pagesThatFit} of ${
        indices.length
      } pages fit in this drawing (${MAX_DRAWING_BYTES / MB} MB limit)`,
    );
  }

  const first = plan.firstPage ?? 0;
  const placement = pageMode
    ? `on pages ${first + 1}–${first + indices.length}`
    : "below the drawing";

  return (
    <Frame
      titleId={titleId}
      onCancel={onCancel}
      onSubmit={() => {
        if (!running && !error) {
          onImport(indices);
        }
      }}
      footer={
        <>
          <button type="button" className="pdfi__btn" onClick={onCancel}>
            Cancel
          </button>
          {!running && (
            <button
              type="submit"
              className="pdfi__btn pdfi__btn--primary"
              disabled={error !== null}
            >
              Import
            </button>
          )}
        </>
      }
    >
      <div className="pdfi__body">
        <div className="pdfi__file">
          <strong className="pdfi__name" title={doc.name}>
            {doc.name}
          </strong>
          <span className="pdfi__muted">{plural(doc.pageCount, "page")}</span>
        </div>
        <label className="pdfi__row">
          <span className="pdfi__label">Pages</span>
          <input
            autoFocus
            type="text"
            className="pdfi__input"
            value={range}
            disabled={running}
            spellCheck={false}
            placeholder="all, or e.g. 1-5, 8, 10-"
            aria-invalid={error !== null}
            aria-describedby={statusId}
            onChange={(event) => setRange(event.target.value)}
          />
        </label>
        <div id={statusId} className="pdfi__status">
          {error ? (
            <div className="pdfi__error" role="alert">
              {error}
            </div>
          ) : (
            <div>
              {plural(indices.length, "page")} {placement}. ≈{" "}
              {formatMb(estimate.totalBytes)}, rendered at {estimate.side} px
            </div>
          )}
          {warnings.map((warning) => (
            <div key={warning} className="pdfi__warning" role="status">
              {warning}
            </div>
          ))}
          <div className="pdfi__muted">Pages stay white in dark mode.</div>
        </div>
        {progress && (
          <div>
            <div>
              Rendering page {Math.min(progress.done + 1, progress.total)} of{" "}
              {progress.total}
            </div>
            <div
              className="pdfi__bar"
              role="progressbar"
              aria-label="Import progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <div
                className="pdfi__bar-fill"
                style={{
                  width: `${
                    progress.total ? (progress.done / progress.total) * 100 : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
};

export const PdfImportDialog = (props: {
  ctx: Pick<PluginContext, "scene">;
  doc: PdfDocument;
  settings: PdfImportSettings;
  progress: PdfImportProgress | null;
  onImport: (indices: number[]) => void;
  onCancel: () => void;
  onUnlock: (password: string) => Promise<void>;
}) =>
  props.doc.locked ? (
    <PasswordPrompt
      doc={props.doc}
      onUnlock={props.onUnlock}
      onCancel={props.onCancel}
    />
  ) : (
    <ImportOptions {...props} />
  );
