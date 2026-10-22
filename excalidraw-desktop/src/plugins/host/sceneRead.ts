/** Plugin-facing read of the active scene (projectScene is frozen and cached per scene version). */
import { projectScene } from "../../sceneOps";
import { getActiveScene } from "../../sceneOps/sceneBus";

import type { SceneElement } from "../../sceneOps";

const EMPTY: readonly SceneElement[] = Object.freeze([]);

/** Elements of the active drawing, [] when none is open or it is swapping. */
export function readScene(): readonly SceneElement[] {
  const scene = getActiveScene();
  return scene ? projectScene(scene.api.getSceneElements()) : EMPTY;
}
