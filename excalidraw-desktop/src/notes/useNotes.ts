import { useLayoutEffect } from "react";

import { useExtension } from "../extensionSwitches/useExtensions";

import { setNotesKind } from "./register";

/** Keeps the notes tab kind registered while the extension is on. */
export function useNotes(): void {
  const on = useExtension("notes");
  useLayoutEffect(() => {
    setNotesKind(on);
    return () => setNotesKind(false);
  }, [on]);
}
