// Chords the browser itself handles (copy, paste, select-all and line start inside a text box)
// follow the real operating system, not the Safari user agent the harness fakes for the app's own
// shortcuts: WebKitGTK on Linux wants Ctrl, WebKit on macOS wants Cmd. The app's own chords
// (undo, select-all on the canvas, ...) stay "Meta" everywhere.
const mac = process.platform === "darwin";
/** The modifier of the browser's own clipboard and text-box chords. */
export const nativeMod = mac ? "Meta" : "Control";
/** Moves the caret to the start of the line in a text box. */
export const lineStartKey = mac ? "Meta+ArrowLeft" : "Home";
