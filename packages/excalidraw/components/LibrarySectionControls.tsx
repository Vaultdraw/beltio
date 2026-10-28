import { useCallback, useEffect, useState } from "react";

import type { LibrarySection, LibraryUIOptions } from "../types";

type Manage = NonNullable<NonNullable<LibraryUIOptions["sections"]>["manage"]>;

const COLLAPSED_KEY = "vaultdraw.library.collapsed";

const readCollapsed = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

/** Which sections are folded; remembered per machine, never required. */
export const useCollapsedSections = () => {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // storage unavailable: folding still works for this session
      }
      return next;
    });
  }, []);
  return { collapsed, toggle };
};

/** Host commands reach the panel through this window event. */
export const LIBRARY_UI_EVENT = "vaultdraw:library-ui";
export type LibraryUIRequest =
  | { action: "new" }
  | { action: "rename" | "remove"; sectionId: string };

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Buttons and inline editors in a section heading: fold, rename, remove. */
export const SectionHeadingControls = ({
  section,
  collapsed,
  onToggle,
  manage,
}: {
  section: LibrarySection;
  collapsed: boolean;
  onToggle: () => void;
  manage?: Manage;
}) => {
  const [mode, setMode] = useState<"rename" | "remove" | null>(null);
  const [name, setName] = useState(section.label);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = (event: Event) => {
      const detail = (event as CustomEvent<LibraryUIRequest>).detail;
      if (detail?.action !== "new" && detail?.sectionId === section.id) {
        setName(section.label);
        setMode(detail.action);
      }
    };
    window.addEventListener(LIBRARY_UI_EVENT, on);
    return () => window.removeEventListener(LIBRARY_UI_EVENT, on);
  }, [section.id, section.label]);

  const run = async (fn: () => void | Promise<void>) => {
    try {
      await fn();
      setMode(null);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const manageable = !!manage && section.manageable;
  return (
    <>
      <button
        type="button"
        className={`library-section-fold${collapsed ? " is-collapsed" : ""}`}
        aria-label={collapsed ? "Expand section" : "Collapse section"}
        aria-expanded={!collapsed}
        data-testid={`library-section-fold-${section.id}`}
        onPointerDown={(e) => e.preventDefault()}
        onClick={onToggle}
      />
      {manageable && mode === null && (
        <span className="library-section-actions">
          <button
            type="button"
            className="library-section-action library-section-action--rename"
            aria-label={`Rename ${section.label}`}
            data-testid={`library-section-rename-${section.id}`}
            onClick={() => {
              setName(section.label);
              setMode("rename");
            }}
          />
          <button
            type="button"
            className="library-section-action library-section-action--remove"
            aria-label={`Remove ${section.label}`}
            data-testid={`library-section-remove-${section.id}`}
            onClick={() => setMode("remove")}
          />
        </span>
      )}
      {manageable && mode === "rename" && (
        <input
          className="library-section-input"
          value={name}
          autoFocus
          aria-label="Library name"
          data-testid="library-section-rename-input"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && name.trim()) {
              void run(() => manage!.rename(section.id, name.trim()));
            } else if (e.key === "Escape") {
              setMode(null);
              setError(null);
            }
          }}
        />
      )}
      {manageable && mode === "remove" && (
        <span className="library-section-confirm">
          <span>Remove?</span>
          <button
            type="button"
            data-testid="library-section-remove-confirm"
            onClick={() => void run(() => manage!.remove(section.id))}
          >
            Remove
          </button>
          <button type="button" onClick={() => setMode(null)}>
            Keep
          </button>
        </span>
      )}
      {error && <span className="library-section-error">{error}</span>}
    </>
  );
};

/** "New library" row at the end of the panel. */
export const NewLibraryRow = ({ manage }: { manage: Manage }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(manage.targets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = (event: Event) => {
      if ((event as CustomEvent<LibraryUIRequest>).detail?.action === "new") {
        setOpen(true);
      }
    };
    window.addEventListener(LIBRARY_UI_EVENT, on);
    return () => window.removeEventListener(LIBRARY_UI_EVENT, on);
  }, []);

  const create = async () => {
    try {
      await manage.create(name.trim(), target || manage.targets[0]?.id);
      setName("");
      setOpen(false);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="library-new-button"
        data-testid="library-new"
        onClick={() => setOpen(true)}
      >
        New library
      </button>
    );
  }
  return (
    <div className="library-new-row">
      <input
        className="library-section-input"
        value={name}
        autoFocus
        placeholder="Library name"
        aria-label="New library name"
        data-testid="library-new-input"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && name.trim()) {
            void create();
          } else if (e.key === "Escape") {
            setOpen(false);
            setError(null);
          }
        }}
      />
      {manage.targets.length > 1 && (
        <select
          aria-label="Create in"
          data-testid="library-new-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {manage.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      {error && <span className="library-section-error">{error}</span>}
    </div>
  );
};
