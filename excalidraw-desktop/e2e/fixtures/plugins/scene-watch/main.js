// Perf: a scene.onChange subscriber that does nothing but count.
export default {
  activate(ctx) {
    window.__sceneWatchCalls = 0;
    ctx.scene.onChange(() => {
      window.__sceneWatchCalls++;
    });
  },
};
