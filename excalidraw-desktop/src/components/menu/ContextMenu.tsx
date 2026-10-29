/**
 * Context-menu renderer for a `MenuNode[]` (menuModel.ts): dividers, submenus
 * with a chevron, a right-aligned key hint, arrow / Home / End / type-ahead
 * keys, ArrowRight and ArrowLeft for submenus, Escape and outside click to
 * close. Nothing is mounted until a menu opens.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useCommandShortcutLookup } from "../../commands/useCommandShortcut";
import { IconCheck, IconChevronRight } from "../Icons";

import { typeAheadIndex, type MenuNode } from "./menuModel";

export const MENU_WIDTH = 220;
/**
 * Menus grow to their longest label, like Obsidian's and Zed's, up to this width; past it a
 * label ends in an ellipsis (test-net TN-11: "Re-import unchanged imported notes here" was cut).
 */
export const MENU_MAX_WIDTH = 380;
const ITEM_SELECTOR =
  ":scope > [role^='menuitem'], :scope > .vault-menu__host > [role^='menuitem']";
const TYPE_AHEAD_RESET_MS = 700;

const itemsOf = (menu: Element): HTMLButtonElement[] =>
  Array.from(menu.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR));

interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  ownerDocument?: Document | null;
  onClose: () => void;
  /** A model to draw; or pass `children` (the sort menu) for plain items. */
  nodes?: readonly MenuNode[];
  children?: ReactNode;
}

/** Positioned `vault-menu` with focus, keyboard and dismiss handling. */
export const ContextMenu = ({
  x,
  y,
  label,
  ownerDocument,
  onClose,
  nodes,
  children,
}: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const win = ownerDocument?.defaultView ?? null;
  const shortcut = useCommandShortcutLookup(win);

  useEffect(() => {
    const menu = menuRef.current;
    const doc = menu?.ownerDocument ?? ownerDocument;
    const view = doc?.defaultView;
    if (!menu || !doc || !view) {
      return;
    }
    itemsOf(menu)[0]?.focus();
    let typed = "";
    let typedAt = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const active = doc.activeElement as HTMLElement | null;
      const current = active?.closest("[role='menu']") ?? menu;
      if (event.key === "Escape" || event.key === "ArrowLeft") {
        // Inside a submenu these close just that submenu (SubMenu's own handler).
        if (current !== menu) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        if (event.key === "Escape") {
          onClose();
        }
        return;
      }
      const items = itemsOf(current);
      const index = items.indexOf(active as HTMLButtonElement);
      const move = (to: number) => {
        event.preventDefault();
        items[(to + items.length) % items.length]?.focus();
      };
      if (event.key === "ArrowDown") {
        move(index + 1);
      } else if (event.key === "ArrowUp") {
        move(index < 0 ? items.length - 1 : index - 1);
      } else if (event.key === "Home") {
        move(0);
      } else if (event.key === "End") {
        move(items.length - 1);
      } else if (event.key === "ArrowRight") {
        if (active?.hasAttribute("aria-haspopup")) {
          event.preventDefault();
          active.click();
          // The submenu mounts on the click; focus its first item next frame.
          view.requestAnimationFrame(() => {
            const sub = active.parentElement?.querySelector("[role='menu']");
            if (sub) {
              itemsOf(sub)[0]?.focus();
            }
          });
        }
      } else if (event.key === "Tab") {
        event.preventDefault();
      } else if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        // A space belongs to the search once a word is under way; else it presses the item.
        (event.key !== " " ||
          (typed !== "" && Date.now() - typedAt <= TYPE_AHEAD_RESET_MS))
      ) {
        const now = Date.now();
        typed = now - typedAt > TYPE_AHEAD_RESET_MS ? "" : typed;
        typed += event.key;
        typedAt = now;
        const hit = typeAheadIndex(
          items.map((i) => i.textContent ?? ""),
          index,
          typed,
        );
        if (hit >= 0) {
          event.preventDefault();
          items[hit].focus();
        }
      }
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("blur", onClose);
    view.addEventListener("resize", onClose);
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("blur", onClose);
      view.removeEventListener("resize", onClose);
    };
  }, [onClose, ownerDocument]);

  // Keep the menu inside the window: flip to the left of the pointer when the
  // right edge would clip, and slide up when the bottom would.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const view = menu?.ownerDocument.defaultView;
    if (!menu || !view) {
      return;
    }
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x - width, view.innerWidth - width - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(
      8,
      Math.min(y, view.innerHeight - height - 8),
    )}px`;
    menu.style.visibility = "visible";
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="vault-menu"
      role="menu"
      aria-label={label}
      style={{
        left: x,
        top: y,
        minWidth: MENU_WIDTH,
        maxWidth: MENU_MAX_WIDTH,
        width: "max-content",
        visibility: "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {nodes ? (
        <MenuNodes nodes={nodes} onClose={onClose} shortcut={shortcut} />
      ) : (
        children
      )}
    </div>
  );
};

/** A plain item, also used directly for the sort menu. */
export const MenuItem = ({
  label,
  danger,
  checked,
  hint,
  onSelect,
}: {
  label: string;
  danger?: boolean;
  checked?: boolean;
  hint?: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemradio"}
    aria-checked={checked}
    className={`vd-row vault-menu__item ${
      danger ? "vault-menu__item--danger" : ""
    }`}
    onClick={onSelect}
  >
    <span className="vault-menu__label">{label}</span>
    {hint && (
      <span className="vault-menu__hint" aria-hidden="true">
        {hint}
      </span>
    )}
    {checked && <IconCheck className="vault-menu__check" />}
  </button>
);

const MenuNodes = ({
  nodes,
  onClose,
  shortcut,
}: {
  nodes: readonly MenuNode[];
  onClose: () => void;
  shortcut: (commandId: string) => string;
}) => {
  const [openSub, setOpenSub] = useState<string | null>(null);
  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === "separator") {
          return (
            <div
              key={`sep${i}`}
              className="vault-menu__separator"
              role="separator"
            />
          );
        }
        if (node.kind === "item") {
          return (
            <button
              key={node.id}
              type="button"
              role="menuitem"
              className={`vd-row vault-menu__item ${
                node.danger ? "vault-menu__item--danger" : ""
              }`}
              onPointerEnter={() => setOpenSub(null)}
              onClick={() => {
                onClose();
                node.run();
              }}
            >
              <span className="vault-menu__label">{node.label}</span>
              {node.commandId && shortcut(node.commandId) && (
                <span className="vault-menu__hint" aria-hidden="true">
                  {shortcut(node.commandId)}
                </span>
              )}
            </button>
          );
        }
        const open = openSub === node.id;
        return (
          <div key={node.id} className="vault-menu__host">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              className="vd-row vault-menu__item"
              onPointerEnter={() => setOpenSub(node.id)}
              onClick={() => setOpenSub(node.id)}
            >
              <span className="vault-menu__label">{node.label}</span>
              <IconChevronRight className="vault-menu__chevron" />
            </button>
            {open && (
              <SubMenu label={node.label} onBack={() => setOpenSub(null)}>
                <MenuNodes
                  nodes={node.items}
                  onClose={onClose}
                  shortcut={shortcut}
                />
              </SubMenu>
            )}
          </div>
        );
      })}
    </>
  );
};

/** A submenu panel beside its parent item; flips left when the right edge would clip. */
const SubMenu = ({
  label,
  onBack,
  children,
}: {
  label: string;
  onBack: () => void;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view) {
      return;
    }
    const box = el.getBoundingClientRect();
    el.classList.toggle(
      "vault-menu--sub-left",
      box.right > view.innerWidth - 8 && box.left - box.width > 8,
    );
    const overflow = box.bottom - (view.innerHeight - 8);
    el.style.top = overflow > 0 ? `${-4 - overflow}px` : "";
  }, []);
  useLayoutEffect(place, [place]);
  return (
    <div
      ref={ref}
      className="vault-menu vault-menu--sub"
      role="menu"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          // Close this submenu; focus returns to its parent item.
          const parent = ref.current?.parentElement?.querySelector<HTMLElement>(
            ":scope > [aria-haspopup]",
          );
          onBack();
          parent?.focus();
        }
      }}
    >
      {children}
    </div>
  );
};
