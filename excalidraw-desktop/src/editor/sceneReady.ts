/**
 * `data-scene-ready` on `.vault-editor`: "true" while the drawing named by
 * `data-document-id` is the scene on screen, "false" from the moment a swap
 * (or a rebuild) starts until the new scene has landed. `data-document-id`
 * alone only says which document the editor shows; a fresh editor sets it
 * before its drawing has loaded.
 */
export const SCENE_READY_ATTR = "data-scene-ready";

/** True when the editor element reports its scene landed. */
export const isSceneReady = (editor: Element | null | undefined): boolean =>
  editor?.getAttribute(SCENE_READY_ATTR) === "true";
