//! macOS app menu. It reproduces Tauri's default menu, except that Cmd+W is
//! "Close Tab" (the frontend closes the active tab; the window never closes
//! from it) and "Close Window" moves to Cmd+Shift+W. Close Window goes through
//! the normal close request, so the renderer's save barrier still runs.
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const CLOSE_TAB_ID: &str = "vault-menu-close-tab";
pub const CLOSE_WINDOW_ID: &str = "vault-menu-close-window";
/// Frontend contract: empty payload, delivered to the focused window.
pub const CLOSE_TAB_EVENT: &str = "vault-close-tab";
/// Help menu items run the matching palette command: id = prefix + command id.
pub const HELP_ITEM_PREFIX: &str = "vault-help:";
/// Frontend contract: payload is the command id (a string).
pub const RUN_COMMAND_EVENT: &str = "vault-run-command";

/// Help menu, in order; `None` is a separator. Command ids are in
/// `src/help/helpCommands.ts`.
const HELP_ITEMS: &[Option<(&str, &str)>] = &[
    Some(("help.website", "Website")),
    Some(("help.docs", "Documentation")),
    Some(("help.keyboard", "Keyboard Shortcuts")),
    None,
    Some(("help.reportBug", "Report a Bug\u{2026}")),
    Some(("help.requestFeature", "Request a Feature\u{2026}")),
    None,
    Some(("help.whatsNew", "What's New")),
    Some(("help.checkUpdates", "Check for Updates\u{2026}")),
    None,
    Some(("help.source", "Source Code")),
    Some(("help.license", "License & Credits")),
];

#[derive(Debug, PartialEq, Eq)]
enum MenuAction {
    CloseTab,
    CloseWindow,
    RunCommand(String),
}

fn action_for(id: &str) -> Option<MenuAction> {
    match id {
        CLOSE_TAB_ID => Some(MenuAction::CloseTab),
        CLOSE_WINDOW_ID => Some(MenuAction::CloseWindow),
        _ => id
            .strip_prefix(HELP_ITEM_PREFIX)
            .map(|command| MenuAction::RunCommand(command.to_string())),
    }
}

fn help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    // HELP_SUBMENU_ID makes Tauri register it as the macOS Help menu (search field, placement).
    let help = Submenu::with_id(app, tauri::menu::HELP_SUBMENU_ID, "Help", true)?;
    for item in HELP_ITEMS {
        match item {
            Some((command, title)) => {
                let id = format!("{HELP_ITEM_PREFIX}{command}");
                help.append(&MenuItem::with_id(app, id, *title, true, None::<&str>)?)?;
            }
            None => help.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(help)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    let close_tab = MenuItem::with_id(app, CLOSE_TAB_ID, "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let close_window = MenuItem::with_id(
        app,
        CLOSE_WINDOW_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    let sep = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &sep()?,
                    &PredefinedMenuItem::services(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&close_tab, &close_window])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
            &help_menu(app)?,
        ],
    )
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let Some(action) = action_for(event.id().as_ref()) else {
        return;
    };
    let focused = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false));
    let Some(window) = focused else { return };
    match action {
        MenuAction::CloseTab => {
            let _ = app.emit_to(window.label(), CLOSE_TAB_EVENT, ());
        }
        // `close` raises CloseRequested (renderer flush barrier); never `destroy`.
        MenuAction::CloseWindow => {
            let _ = window.close();
        }
        MenuAction::RunCommand(command) => {
            let _ = app.emit_to(window.label(), RUN_COMMAND_EVENT, command);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_items_are_help_commands() {
        let n = HELP_ITEMS.iter().flatten().count();
        assert_eq!(n, 9);
        assert!(HELP_ITEMS.iter().flatten().all(|(c, _)| c.starts_with("help.")));
    }

    #[test]
    fn maps_item_ids_to_actions() {
        assert_eq!(action_for(CLOSE_TAB_ID), Some(MenuAction::CloseTab));
        assert_eq!(action_for(CLOSE_WINDOW_ID), Some(MenuAction::CloseWindow));
        assert_eq!(action_for("other"), None);
        assert_eq!(
            action_for("vault-help:help.docs"),
            Some(MenuAction::RunCommand("help.docs".to_string()))
        );
    }

    #[test]
    fn event_name_is_the_frontend_contract() {
        assert_eq!(CLOSE_TAB_EVENT, "vault-close-tab");
        assert_eq!(RUN_COMMAND_EVENT, "vault-run-command");
    }
}
