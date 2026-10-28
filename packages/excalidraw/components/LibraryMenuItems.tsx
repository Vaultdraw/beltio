import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  KEYS,
  MIME_TYPES,
  arrayToMap,
  nextAnimationFrame,
} from "@excalidraw/common";

import { duplicateElements } from "@excalidraw/element";

import clsx from "clsx";

import { getLibraryItemFiles, resolveLibrarySectionId } from "../data/library";
import { deburr } from "../deburr";
import { useAtom, useSetAtom } from "../editor-jotai";

import { useLibraryCache } from "../hooks/useLibraryItemSvg";
import { useScrollPosition } from "../hooks/useScrollPosition";
import { t } from "../i18n";

import { LibraryMenuControlButtons } from "./LibraryMenuControlButtons";
import { LibraryDropdownMenu } from "./LibraryMenuHeaderContent";
import {
  NewLibraryRow,
  SectionHeadingControls,
  useCollapsedSections,
} from "./LibrarySectionControls";
import {
  LibraryMenuSection,
  LibraryMenuSectionGrid,
} from "./LibraryMenuSection";

import Spinner from "./Spinner";
import Stack from "./Stack";

import "./LibraryMenuItems.scss";

import { TextField } from "./TextField";

import { useApp, useEditorInterface } from "./App";
import { isLibraryMenuOpenAtom } from "./LibraryMenu";
import {
  LIBRARY_ITEM_NAME_MAX_LENGTH,
  libraryAddNamingAtom,
  libraryItemRenamingAtom,
} from "./LibraryUnit";

import { Button } from "./Button";

import type { ExcalidrawLibraryIds } from "../data/types";

import type {
  ExcalidrawProps,
  LibraryItem,
  LibraryItems,
  UIAppState,
} from "../types";

// using an odd number of items per batch so the rendering creates an irregular
// pattern which looks more organic
const ITEMS_RENDERED_PER_BATCH = 17;
// when render outputs cached we can render many more items per batch to
// speed it up
const CACHED_ITEMS_RENDERED_PER_BATCH = 64;

const searchTextCache = new WeakMap<LibraryItem, string>();
/**
 * What library search matches: the item's name and its content (text
 * elements, incl. labels bound to shapes/arrows, and frame names), case and
 * accent folded. Computed once per item object (items are immutable, a
 * changed item is a new object).
 */
export const getLibraryItemSearchText = (item: LibraryItem) => {
  let text = searchTextCache.get(item);
  if (text === undefined) {
    const parts = [item.name ?? ""];
    for (const element of item.elements) {
      if (element.type === "text") {
        parts.push(element.originalText || element.text);
      } else if (
        (element.type === "frame" || element.type === "magicframe") &&
        element.name
      ) {
        parts.push(element.name);
      }
    }
    text = deburr(parts.join("\n").toLowerCase());
    searchTextCache.set(item, text);
  }
  return text;
};

/** The item with `name` (trimmed; empty removes the name). */
export const withLibraryItemName = (
  item: LibraryItem,
  name: string,
): LibraryItem => {
  const trimmed = name.trim().slice(0, LIBRARY_ITEM_NAME_MAX_LENGTH);
  const { name: _previous, ...rest } = item;
  return trimmed ? { ...rest, name: trimmed } : rest;
};

export default function LibraryMenuItems({
  isLoading,
  libraryItems,
  onAddToLibrary,
  onInsertLibraryItems,
  pendingElements,
  theme,
  id,
  libraryReturnUrl,
  libraryUIOptions,
  onSelectItems,
  selectedItems,
}: {
  isLoading: boolean;
  libraryItems: LibraryItems;
  pendingElements: LibraryItem["elements"];
  onInsertLibraryItems: (libraryItems: LibraryItems) => void;
  onAddToLibrary: (
    elements: LibraryItem["elements"],
    sectionId?: string,
    name?: string,
  ) => void;
  libraryReturnUrl: ExcalidrawProps["libraryReturnUrl"];
  libraryUIOptions?: ExcalidrawProps["libraryUIOptions"];
  theme: UIAppState["theme"];
  id: string;
  selectedItems: LibraryItem["id"][];
  onSelectItems: (id: LibraryItem["id"][]) => void;
}) {
  const editorInterface = useEditorInterface();
  const sections = libraryUIOptions?.sections;
  const online = libraryUIOptions?.online !== false;
  const namedItems = !!libraryUIOptions?.namedItems;
  const app = useApp();
  const { library } = app;
  const pendingItems = useMemo(
    () => [
      {
        id: null,
        elements: pendingElements,
        files: getLibraryItemFiles(pendingElements, app.files),
      },
    ],
    [pendingElements, app],
  );
  const [renamingId, setRenamingId] = useAtom(libraryItemRenamingAtom);
  const [namingSection, setNamingSection] = useAtom(libraryAddNamingAtom);
  const { collapsed: foldedSections, toggle: toggleSection } =
    useCollapsedSections();
  const setLibraryMenuOpen = useSetAtom(isLibraryMenuOpenAtom);
  const libraryContainerRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useScrollPosition<HTMLDivElement>(libraryContainerRef);

  // This effect has to be called only on first render, therefore  `scrollPosition` isn't in the dependency array
  useEffect(() => {
    if (scrollPosition > 0) {
      libraryContainerRef.current?.scrollTo(0, scrollPosition);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { svgCache } = useLibraryCache();
  const [lastSelectedItem, setLastSelectedItem] = useState<
    LibraryItem["id"] | null
  >(null);

  const [searchInputValue, setSearchInputValue] = useState("");

  const IS_LIBRARY_EMPTY = !libraryItems.length && !pendingElements.length;

  const IS_SEARCHING = !IS_LIBRARY_EMPTY && !!searchInputValue.trim();

  const filteredItems = useMemo(() => {
    const searchQuery = deburr(searchInputValue.trim().toLowerCase());
    if (!searchQuery) {
      return [];
    }

    return libraryItems.filter((item) =>
      getLibraryItemSearchText(item).includes(searchQuery),
    );
  }, [libraryItems, searchInputValue]);

  const unpublishedItems = useMemo(
    () => libraryItems.filter((item) => item.status !== "published"),
    [libraryItems],
  );

  const publishedItems = useMemo(
    () => libraryItems.filter((item) => item.status === "published"),
    [libraryItems],
  );

  // one bucket per section, in `list` order (single pass, no per-item lookups)
  const sectionedItems = useMemo(() => {
    if (!sections) {
      return null;
    }
    const buckets = new Map<string, LibraryItem[]>(
      sections.list.map((section) => [section.id, []]),
    );
    for (const item of libraryItems) {
      buckets.get(resolveLibrarySectionId(sections, item.id))?.push(item);
    }
    return sections.list.map((section) => ({
      section,
      items: buckets.get(section.id)!,
    }));
  }, [libraryItems, sections]);

  const onItemSelectToggle = useCallback(
    (id: LibraryItem["id"], event: React.MouseEvent) => {
      const shouldSelect = !selectedItems.includes(id);
      const orderedItems = sectionedItems
        ? sectionedItems.flatMap((bucket) => bucket.items)
        : [...unpublishedItems, ...publishedItems];
      if (shouldSelect) {
        if (event.shiftKey && lastSelectedItem) {
          const rangeStart = orderedItems.findIndex(
            (item) => item.id === lastSelectedItem,
          );
          const rangeEnd = orderedItems.findIndex((item) => item.id === id);

          if (rangeStart === -1 || rangeEnd === -1) {
            onSelectItems([...selectedItems, id]);
            return;
          }

          const selectedItemsMap = arrayToMap(selectedItems);
          // Support both top-down and bottom-up selection by using min/max
          const minRange = Math.min(rangeStart, rangeEnd);
          const maxRange = Math.max(rangeStart, rangeEnd);
          const nextSelectedIds = orderedItems.reduce(
            (acc: LibraryItem["id"][], item, idx) => {
              if (
                (idx >= minRange && idx <= maxRange) ||
                selectedItemsMap.has(item.id)
              ) {
                acc.push(item.id);
              }
              return acc;
            },
            [],
          );
          onSelectItems(nextSelectedIds);
        } else {
          onSelectItems([...selectedItems, id]);
        }
        setLastSelectedItem(id);
      } else {
        setLastSelectedItem(null);
        onSelectItems(selectedItems.filter((_id) => _id !== id));
      }
    },
    [
      lastSelectedItem,
      onSelectItems,
      publishedItems,
      sectionedItems,
      selectedItems,
      unpublishedItems,
    ],
  );

  useEffect(() => {
    // if selection is removed (e.g. via esc), reset last selected item
    // so that subsequent shift+clicks don't select a large range
    if (!selectedItems.length) {
      setLastSelectedItem(null);
    }
  }, [selectedItems]);

  const getInsertedElements = useCallback(
    (id: string) => {
      let targetElements;
      if (selectedItems.includes(id)) {
        targetElements = libraryItems.filter((item) =>
          selectedItems.includes(item.id),
        );
      } else {
        targetElements = libraryItems.filter((item) => item.id === id);
      }
      return targetElements.map((item) => {
        return {
          ...item,
          // duplicate each library item before inserting on canvas to confine
          // ids and bindings to each library item. See #6465
          elements: duplicateElements({
            type: "everything",
            elements: item.elements,
            randomizeSeed: true,
            preserveFrameChildrenOrder: true,
          }).duplicatedElements,
        };
      });
    },
    [libraryItems, selectedItems],
  );

  const onItemDrag = useCallback(
    (id: LibraryItem["id"], event: React.DragEvent) => {
      // we want to serialize just the ids so the operation is fast and there's
      // no race condition if people drop the library items on canvas too fast
      const data: ExcalidrawLibraryIds = {
        itemIds: selectedItems.includes(id) ? selectedItems : [id],
      };
      event.dataTransfer.setData(
        MIME_TYPES.excalidrawlibIds,
        JSON.stringify(data),
      );
    },
    [selectedItems],
  );

  const isItemSelected = useCallback(
    (id: LibraryItem["id"] | null) => {
      if (!id) {
        return false;
      }
      return selectedItems.includes(id);
    },
    [selectedItems],
  );

  const onAddToLibraryClick = useCallback(() => {
    onAddToLibrary(pendingElements);
  }, [pendingElements, onAddToLibrary]);

  // nothing left to add (selection cleared): drop the name field
  const hasPending = pendingElements.length > 0;
  useEffect(() => {
    if (!hasPending) {
      setNamingSection(null);
    }
  }, [hasPending, setNamingSection]);

  /** The add tile: with named items it asks for the name first. */
  const getPendingProps = (sectionId?: string) => {
    const key = sectionId ?? "";
    if (!namedItems) {
      return {
        theme,
        showNames: false,
        onClick: sectionId
          ? () => onAddToLibrary(pendingElements, sectionId)
          : onAddToLibraryClick,
      };
    }
    return {
      theme,
      showNames: true,
      onClick: () => setNamingSection(key),
      pendingNaming: namingSection === key,
      onRenameEnd: (_id: LibraryItem["id"] | null, name: string | null) => {
        setNamingSection(null);
        if (name) {
          onAddToLibrary(pendingElements, sectionId, name);
        }
      },
    };
  };

  const onItemClick = useCallback(
    (id: LibraryItem["id"] | null) => {
      if (id) {
        onInsertLibraryItems(getInsertedElements(id));
      }
    },
    [getInsertedElements, onInsertLibraryItems],
  );

  const onRenameStart = useCallback(
    (id: LibraryItem["id"]) => setRenamingId(id),
    [setRenamingId],
  );

  const onRenameEnd = useCallback(
    (id: LibraryItem["id"] | null, name: string | null) => {
      setRenamingId(null);
      const item = id && libraryItems.find((item) => item.id === id);
      if (
        // a name is required: clearing it is the same as cancelling
        !name ||
        !item ||
        withLibraryItemName(item, name).name === item.name
      ) {
        return;
      }
      library
        .setLibrary((latest) =>
          latest.map((item) =>
            item.id === id ? withLibraryItemName(item, name) : item,
          ),
        )
        .catch(console.error);
    },
    [library, libraryItems, setRenamingId],
  );

  // right-click: the item's actions (the library menu) for it
  const onItemContextMenu = useCallback(
    (id: LibraryItem["id"]) => {
      if (!selectedItems.includes(id)) {
        onSelectItems([id]);
      }
      setLibraryMenuOpen(true);
    },
    [onSelectItems, selectedItems, setLibraryMenuOpen],
  );

  const itemProps = {
    theme,
    showNames: namedItems,
    ...(namedItems && {
      renamingId,
      onRenameStart,
      onRenameEnd,
      onItemContextMenu,
    }),
  };

  const itemsRenderedPerBatch =
    svgCache.size >=
    (filteredItems.length ? filteredItems : libraryItems).length
      ? CACHED_ITEMS_RENDERED_PER_BATCH
      : ITEMS_RENDERED_PER_BATCH;

  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // focus could be stolen by tab trigger button
    nextAnimationFrame(() => {
      // unless a library item's name field took it (e.g. "Add to library")
      if (!document.activeElement?.closest(".library-unit")) {
        searchInputRef.current?.focus();
      }
    });
  }, []);

  // An empty sectioned library has no search box: the menu joins the first
  // section's heading instead of sitting alone in a row of its own.
  const menuInFirstSection = IS_LIBRARY_EMPTY && !!sectionedItems;
  const dropdownMenu = (
    <LibraryDropdownMenu
      selectedItems={selectedItems}
      onSelectItems={onSelectItems}
      className="library-menu-dropdown-container--in-heading"
    />
  );

  const JSX_whenSectioned = !IS_SEARCHING && sectionedItems && (
    <>
      {sectionedItems.map(({ section, items }, index) => (
        <React.Fragment key={section.id}>
          <div
            className="library-menu-items-container__header"
            style={index > 0 ? { marginTop: "0.75rem" } : undefined}
            data-testid={`library-section-${section.id}`}
          >
            <SectionHeadingControls
              section={section}
              collapsed={foldedSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              manage={sections?.manage}
            />
            {section.label}
            {index === 0 && menuInFirstSection && dropdownMenu}
          </div>
          {foldedSections.has(section.id) ? null : !items.length &&
            !(pendingElements.length > 0 && section.canAdd !== false) ? (
            <div className="library-menu-items__no-items library-menu-items__no-items--section">
              <div className="library-menu-items__no-items__hint">
                {section.emptyHint ?? t("library.emptySection")}
              </div>
            </div>
          ) : (
            <LibraryMenuSectionGrid showNames={namedItems}>
              {pendingElements.length > 0 && section.canAdd !== false && (
                <LibraryMenuSection
                  itemsRenderedPerBatch={itemsRenderedPerBatch}
                  items={pendingItems}
                  onItemSelectToggle={onItemSelectToggle}
                  onItemDrag={onItemDrag}
                  isItemSelected={isItemSelected}
                  svgCache={svgCache}
                  {...getPendingProps(section.id)}
                />
              )}
              <LibraryMenuSection
                itemsRenderedPerBatch={itemsRenderedPerBatch}
                items={items}
                onItemSelectToggle={onItemSelectToggle}
                onItemDrag={onItemDrag}
                onClick={onItemClick}
                isItemSelected={isItemSelected}
                svgCache={svgCache}
                {...itemProps}
              />
            </LibraryMenuSectionGrid>
          )}
        </React.Fragment>
      ))}
      {sections?.manage && <NewLibraryRow manage={sections.manage} />}
    </>
  );

  const JSX_whenNotSearching = !IS_SEARCHING && !sectionedItems && (
    <>
      {!IS_LIBRARY_EMPTY && (
        <div className="library-menu-items-container__header">
          {t("labels.personalLib")}
        </div>
      )}
      {!pendingElements.length && !unpublishedItems.length ? (
        <div className="library-menu-items__no-items">
          {!publishedItems.length && (
            <div className="library-menu-items__no-items__label">
              {t("library.noItems")}
            </div>
          )}
          <div className="library-menu-items__no-items__hint">
            {publishedItems.length > 0
              ? t("library.hint_emptyPrivateLibrary")
              : t("library.hint_emptyLibrary")}
          </div>
        </div>
      ) : (
        <LibraryMenuSectionGrid showNames={namedItems}>
          {pendingElements.length > 0 && (
            <LibraryMenuSection
              itemsRenderedPerBatch={itemsRenderedPerBatch}
              items={pendingItems}
              onItemSelectToggle={onItemSelectToggle}
              onItemDrag={onItemDrag}
              isItemSelected={isItemSelected}
              svgCache={svgCache}
              {...getPendingProps()}
            />
          )}
          <LibraryMenuSection
            itemsRenderedPerBatch={itemsRenderedPerBatch}
            items={unpublishedItems}
            onItemSelectToggle={onItemSelectToggle}
            onItemDrag={onItemDrag}
            onClick={onItemClick}
            isItemSelected={isItemSelected}
            svgCache={svgCache}
            {...itemProps}
          />
        </LibraryMenuSectionGrid>
      )}

      {publishedItems.length > 0 && (
        <div
          className="library-menu-items-container__header"
          style={{ marginTop: "0.75rem" }}
        >
          {t("labels.excalidrawLib")}
        </div>
      )}
      {publishedItems.length > 0 && (
        <LibraryMenuSectionGrid showNames={namedItems}>
          <LibraryMenuSection
            itemsRenderedPerBatch={itemsRenderedPerBatch}
            items={publishedItems}
            onItemSelectToggle={onItemSelectToggle}
            onItemDrag={onItemDrag}
            onClick={onItemClick}
            isItemSelected={isItemSelected}
            svgCache={svgCache}
            {...itemProps}
          />
        </LibraryMenuSectionGrid>
      )}
    </>
  );

  const JSX_whenSearching = IS_SEARCHING && (
    <>
      <div className="library-menu-items-container__header">
        {t("library.search.heading")}
        {!isLoading && (
          <div
            className="library-menu-items-container__header__hint"
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={(event) => {
              setSearchInputValue("");
            }}
          >
            <kbd>esc</kbd> to clear
          </div>
        )}
      </div>
      {filteredItems.length > 0 ? (
        <LibraryMenuSectionGrid showNames>
          <LibraryMenuSection
            itemsRenderedPerBatch={itemsRenderedPerBatch}
            items={filteredItems}
            onItemSelectToggle={onItemSelectToggle}
            onItemDrag={onItemDrag}
            onClick={onItemClick}
            isItemSelected={isItemSelected}
            svgCache={svgCache}
            {...itemProps}
            showNames
          />
        </LibraryMenuSectionGrid>
      ) : (
        <div className="library-menu-items__no-items">
          <div className="library-menu-items__no-items__hint">
            {t("library.search.noResults")}
          </div>
          <Button
            onPointerDown={(e) => e.preventDefault()}
            onSelect={() => {
              setSearchInputValue("");
            }}
            style={{ width: "auto", marginTop: "1rem" }}
          >
            {t("library.search.clearSearch")}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div
      className="library-menu-items-container"
      style={
        pendingElements.length ||
        unpublishedItems.length ||
        publishedItems.length
          ? { justifyContent: "flex-start" }
          : { borderBottom: 0 }
      }
    >
      {!menuInFirstSection && (
        <div className="library-menu-items-header">
          {!IS_LIBRARY_EMPTY && (
            <TextField
              ref={searchInputRef}
              type="search"
              className={clsx("library-menu-items-container__search", {
                hideCancelButton: editorInterface.formFactor !== "phone",
              })}
              placeholder={t("library.search.inputPlaceholder")}
              value={searchInputValue}
              onChange={(value) => setSearchInputValue(value)}
              onKeyDown={(event) => {
                // clear the search ourselves and stop the event, or the
                // sidebar's Escape listener closes an undocked sidebar
                if (event.key === KEYS.ESCAPE && searchInputValue) {
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchInputValue("");
                }
              }}
            />
          )}
          {dropdownMenu}
        </div>
      )}
      <Stack.Col
        className="library-menu-items-container__items"
        align="start"
        gap={1}
        style={{
          flex: publishedItems.length > 0 || sectionedItems ? 1 : "0 1 auto",
          margin: IS_LIBRARY_EMPTY ? "auto" : 0,
        }}
        ref={libraryContainerRef}
      >
        {isLoading && (
          <div
            style={{
              position: "absolute",
              top: "var(--container-padding-y)",
              right: "var(--container-padding-x)",
              transform: "translateY(50%)",
            }}
          >
            <Spinner />
          </div>
        )}

        {JSX_whenSectioned}
        {JSX_whenNotSearching}
        {JSX_whenSearching}

        {IS_LIBRARY_EMPTY && (
          <LibraryMenuControlButtons
            style={{ padding: "16px 0", width: "100%" }}
            id={id}
            libraryReturnUrl={libraryReturnUrl}
            online={online}
            theme={theme}
          />
        )}
      </Stack.Col>
    </div>
  );
}
