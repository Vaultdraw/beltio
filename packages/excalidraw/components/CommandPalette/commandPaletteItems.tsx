import { DEFAULT_SIDEBAR, KEYS, arrayToMap } from "@excalidraw/common";

import type { MarkRequired } from "@excalidraw/common/utility-types";

import { actionToggleShapeSwitch } from "../../actions/actionToggleShapeSwitch";
import {
  actionClearCanvas,
  actionLink,
  actionToggleSearchMenu,
  actionToggleTheme,
} from "../../actions";
import {
  actionCopyElementLink,
  actionLinkToElement,
} from "../../actions/actionElementLink";
import { getShortcutFromShortcutName } from "../../actions/shortcuts";
import { deburr } from "../../deburr";
import { editorJotaiStore } from "../../editor-jotai";
import { t } from "../../i18n";
import { getSelectedElements } from "../../scene";
import {
  LockedIcon,
  UnlockedIcon,
  searchIcon,
  boltIcon,
  bucketFillIcon,
  ExportImageIcon,
  mermaidLogoIcon,
  brainIconThin,
  LibraryIcon,
} from "../icons";
import { TOOLS, getToolLetter } from "../Tools";
import { canChangeBackgroundColor, canChangeStrokeColor } from "../Actions";
import { activeConfirmDialogAtom } from "../ActiveConfirmDialog";

import type { CommandPaletteItem } from "./types";
import type { ToolbarToolType } from "../Tools";
import type {
  AppClassProperties,
  AppProps,
  AppState,
  UIAppState,
} from "../../types";
import type { ShortcutName } from "../../actions/shortcuts";
import type { TranslationKeys } from "../../i18n";
import type { Action } from "../../actions/types";
import type { ActionManager } from "../../actions/manager";
import type App from "../App";

export const DEFAULT_CATEGORIES = {
  app: "App",
  export: "Export",
  tools: "Tools",
  editor: "Editor",
  elements: "Elements",
  links: "Links",
  library: "Library",
};

export const getCategoryOrder = (category: string) => {
  switch (category) {
    case DEFAULT_CATEGORIES.app:
      return 1;
    case DEFAULT_CATEGORIES.export:
      return 2;
    case DEFAULT_CATEGORIES.editor:
      return 3;
    case DEFAULT_CATEGORIES.tools:
      return 4;
    case DEFAULT_CATEGORIES.elements:
      return 5;
    case DEFAULT_CATEGORIES.links:
      return 6;
    default:
      return 10;
  }
};

/** Adds the icon fallback, category order and search haystack. */
export const withPaletteDefaults = (
  command: CommandPaletteItem,
): MarkRequired<CommandPaletteItem, "haystack" | "order"> => ({
  ...command,
  icon: command.icon || boltIcon,
  order: command.order ?? getCategoryOrder(command.category),
  haystack: `${deburr(command.label.toLocaleLowerCase())} ${
    command.keywords?.join(" ") || ""
  }`,
});

/** Whether the item can run now (view-mode rule + predicate). */
export const isCommandPaletteItemAvailable = (
  command: CommandPaletteItem,
  {
    app,
    appState,
    appProps,
  }: { app: AppClassProperties; appState: UIAppState; appProps: AppProps },
) => {
  if (command.viewMode === false && appState.viewModeEnabled) {
    return false;
  }

  return typeof command.predicate === "function"
    ? command.predicate(
        app.scene.getNonDeletedElements(),
        appState as AppState,
        appProps,
        app,
      )
    : command.predicate === undefined || command.predicate;
};

/**
 * Builds Excalidraw's built-in command palette items (no library items, no
 * host-provided custom items).
 */
export const getCommandPaletteItems = ({
  app,
  actionManager,
  uiAppState,
  appProps,
  setAppState,
}: {
  app: AppClassProperties;
  actionManager: ActionManager;
  uiAppState: UIAppState;
  appProps: AppProps;
  setAppState: App["setAppState"];
}): MarkRequired<CommandPaletteItem, "haystack" | "order">[] => {
  const getActionLabel = (action: Action) => {
    let label = "";
    if (action.label) {
      if (typeof action.label === "function") {
        label = t(
          action.label(
            app.scene.getNonDeletedElements(),
            uiAppState,
            app,
          ) as unknown as TranslationKeys,
        );
      } else {
        label = t(action.label as unknown as TranslationKeys);
      }
    }
    return label;
  };

  const getActionIcon = (action: Action) => {
    if (typeof action.icon === "function") {
      return action.icon(uiAppState, app.scene.getNonDeletedElements());
    }
    return action.icon;
  };

  const actionToCommand = (
    action: Action,
    category: string,
    transformer?: (
      command: CommandPaletteItem,
      action: Action,
    ) => CommandPaletteItem,
  ): CommandPaletteItem => {
    const command: CommandPaletteItem = {
      id: action.name,
      label: getActionLabel(action),
      icon: getActionIcon(action),
      category,
      shortcut: getShortcutFromShortcutName(action.name as ShortcutName),
      keywords: action.keywords,
      predicate: action.predicate,
      viewMode: action.viewMode,
      perform: () => {
        actionManager.executeAction(action, "commandPalette");
      },
    };

    return transformer ? transformer(command, action) : command;
  };

  const elementsCommands: CommandPaletteItem[] = [
    actionManager.actions.group,
    actionManager.actions.ungroup,
    actionManager.actions.cut,
    actionManager.actions.copy,
    actionManager.actions.deleteSelectedElements,
    actionManager.actions.wrapSelectionInFrame,
    actionManager.actions.copyStyles,
    actionManager.actions.pasteStyles,
    actionManager.actions.bringToFront,
    actionManager.actions.bringForward,
    actionManager.actions.sendBackward,
    actionManager.actions.sendToBack,
    actionManager.actions.alignTop,
    actionManager.actions.alignBottom,
    actionManager.actions.alignLeft,
    actionManager.actions.alignRight,
    actionManager.actions.alignVerticallyCentered,
    actionManager.actions.alignHorizontallyCentered,
    actionManager.actions.duplicateSelection,
    actionManager.actions.flipHorizontal,
    actionManager.actions.flipVertical,
    actionManager.actions.zoomToFitSelection,
    actionManager.actions.zoomToFitSelectionInViewport,
    actionManager.actions.increaseFontSize,
    actionManager.actions.decreaseFontSize,
    actionManager.actions.toggleLinearEditor,
    actionManager.actions.cropEditor,
    actionManager.actions.togglePolygon,
    actionLink,
    actionCopyElementLink,
    actionLinkToElement,
    actionManager.actions.addToLibrary,
  ].map((action: Action) =>
    actionToCommand(action, DEFAULT_CATEGORIES.elements, (command, action) => ({
      ...command,
      predicate: action.predicate
        ? action.predicate
        : (elements, appState, appProps, app) => {
            const selectedElements = getSelectedElements(elements, appState);
            return selectedElements.length > 0;
          },
    })),
  );
  const editorCommands: CommandPaletteItem[] = [
    actionManager.actions.undo,
    actionManager.actions.redo,
    actionManager.actions.zoomIn,
    actionManager.actions.zoomOut,
    actionManager.actions.resetZoom,
    actionManager.actions.zoomToFit,
    actionManager.actions.zenMode,
    actionManager.actions.viewMode,
    actionManager.actions.gridMode,
    actionManager.actions.objectsSnapMode,
    actionManager.actions.showHints,
    actionManager.actions.toggleShortcuts,
    actionManager.actions.selectAll,
    actionManager.actions.toggleElementLock,
    actionManager.actions.unlockAllElements,
    actionManager.actions.stats,
  ].map((action) => actionToCommand(action, DEFAULT_CATEGORIES.editor));

  const exportCommands: CommandPaletteItem[] = [
    actionManager.actions.saveToActiveFile,
    actionManager.actions.saveFileToDisk,
    actionManager.actions.copyAsPng,
    actionManager.actions.copyAsSvg,
  ].map((action) => actionToCommand(action, DEFAULT_CATEGORIES.export));

  const commandsFromActions: CommandPaletteItem[] = [
    ...elementsCommands,
    ...editorCommands,
    {
      id: "clearCanvas",
      label: getActionLabel(actionClearCanvas),
      icon: getActionIcon(actionClearCanvas),
      shortcut: getShortcutFromShortcutName(
        actionClearCanvas.name as ShortcutName,
      ),
      category: DEFAULT_CATEGORIES.editor,
      keywords: ["delete", "destroy"],
      viewMode: false,
      perform: () => {
        editorJotaiStore.set(activeConfirmDialogAtom, "clearCanvas");
      },
    },
    {
      id: "imageExport",
      label: t("buttons.exportImage"),
      category: DEFAULT_CATEGORIES.export,
      icon: ExportImageIcon,
      shortcut: getShortcutFromShortcutName("imageExport"),
      keywords: [
        "export",
        "image",
        "png",
        "jpeg",
        "svg",
        "clipboard",
        "picture",
      ],
      perform: () => {
        setAppState({ openDialog: { name: "imageExport" } });
      },
    },
    ...exportCommands,
  ];

  const additionalCommands: CommandPaletteItem[] = [
    actionToCommand(actionToggleTheme, DEFAULT_CATEGORIES.app),
    {
      id: "library",
      label: t("toolBar.library"),
      category: DEFAULT_CATEGORIES.app,
      icon: LibraryIcon,
      viewMode: false,
      perform: () => {
        if (uiAppState.openSidebar) {
          setAppState({
            openSidebar: null,
          });
        } else {
          setAppState({
            openSidebar: {
              name: DEFAULT_SIDEBAR.name,
              tab: DEFAULT_SIDEBAR.defaultTab,
            },
          });
        }
      },
    },
    {
      id: "searchMenu",
      label: t("search.title"),
      category: DEFAULT_CATEGORIES.app,
      icon: searchIcon,
      viewMode: true,
      perform: () => {
        actionManager.executeAction(actionToggleSearchMenu);
      },
    },
    {
      id: "shapeSwitch",
      label: t("labels.shapeSwitch"),
      category: DEFAULT_CATEGORIES.elements,
      icon: boltIcon,
      perform: () => {
        actionManager.executeAction(actionToggleShapeSwitch);
      },
    },
    {
      id: "changeStroke",
      label: t("labels.changeStroke"),
      keywords: ["color", "outline"],
      category: DEFAULT_CATEGORIES.elements,
      icon: bucketFillIcon,
      viewMode: false,
      predicate: (elements, appState) => {
        const selectedElements = getSelectedElements(elements, appState);
        return (
          selectedElements.length > 0 &&
          canChangeStrokeColor(appState, selectedElements)
        );
      },
      perform: () => {
        setAppState((prevState) => ({
          openPopup: "elementStroke",
        }));
      },
    },
    {
      id: "changeBackground",
      label: t("labels.changeBackground"),
      keywords: ["color", "fill"],
      icon: bucketFillIcon,
      category: DEFAULT_CATEGORIES.elements,
      viewMode: false,
      predicate: (elements, appState) => {
        const selectedElements = getSelectedElements(elements, appState);
        return (
          selectedElements.length > 0 &&
          canChangeBackgroundColor(
            appState,
            selectedElements,
            arrayToMap(elements),
          )
        );
      },
      perform: () => {
        setAppState((prevState) => ({
          openPopup: "elementBackground",
        }));
      },
    },
    {
      id: "canvasBackground",
      label: t("labels.canvasBackground"),
      keywords: ["color"],
      icon: bucketFillIcon,
      category: DEFAULT_CATEGORIES.editor,
      viewMode: false,
      perform: () => {
        setAppState((prevState) => ({
          openMenu: prevState.openMenu === "canvas" ? null : "canvas",
          openPopup: "canvasBackground",
        }));
      },
    },
    ...(Object.keys(TOOLS) as ToolbarToolType[]).reduce(
      (acc: CommandPaletteItem[], value) => {
        const config = TOOLS[value];

        if (
          appProps.UIOptions.tools?.[
            value as Extract<typeof value, keyof AppProps["UIOptions"]["tools"]>
          ] === false
        ) {
          return acc;
        }

        const shortcut = getToolLetter(value) || config.numericKey;

        const command: CommandPaletteItem = {
          id: `tool.${value}`,
          label: t(`toolBar.${value}`),
          category: DEFAULT_CATEGORIES.tools,
          shortcut,
          icon: config.icon,
          keywords: ["toolbar"],
          viewMode: false,
          perform: () => {
            app.setActiveTool({ type: value }, { toggle: false });
          },
        };

        acc.push(command);

        return acc;
      },
      [],
    ),
    {
      id: "toolLock",
      label: t("toolBar.lock"),
      category: DEFAULT_CATEGORIES.tools,
      icon: uiAppState.activeTool.locked ? LockedIcon : UnlockedIcon,
      shortcut: KEYS.Q.toLocaleUpperCase(),
      viewMode: false,
      perform: () => {
        app.toggleLock();
      },
    },
    {
      id: "textToDiagram",
      label: `${t("labels.textToDiagram")}...`,
      category: DEFAULT_CATEGORIES.tools,
      icon: brainIconThin,
      viewMode: false,
      predicate: appProps.aiEnabled,
      perform: () => {
        setAppState((state) => ({
          ...state,
          openDialog: {
            name: "ttd",
            tab: "text-to-diagram",
          },
        }));
      },
    },
    {
      id: "mermaid",
      label: `${t("toolBar.mermaidToExcalidraw")}...`,
      category: DEFAULT_CATEGORIES.tools,
      icon: mermaidLogoIcon,
      viewMode: false,
      predicate: appProps.UIOptions.tools?.mermaid !== false,
      perform: () => {
        setAppState((state) => ({
          ...state,
          openDialog: {
            name: "ttd",
            tab: "mermaid",
          },
        }));
      },
    },
    // {
    //   label: `${t("toolBar.magicframe")}...`,
    //   category: DEFAULT_CATEGORIES.tools,
    //   icon: MagicIconThin,
    //   viewMode: false,
    //   predicate: appProps.aiEnabled,
    //   perform: () => {
    //     app.onMagicframeToolSelect();
    //   },
    // },
  ];

  return [...commandsFromActions, ...additionalCommands].map(
    withPaletteDefaults,
  );
};
