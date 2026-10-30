export default {
  async activate(ctx) {
    ctx.commands.register("slow", () => ctx.ui.toast("slow ran"));
    await new Promise((r) => setTimeout(r, 4000));
  },
};
