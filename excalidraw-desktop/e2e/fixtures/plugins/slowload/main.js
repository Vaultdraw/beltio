export default {
  async activate(ctx) {
    let n = 0;
    ctx.commands.register("slow", () => ctx.ui.toast("slow ran " + ++n));
    await new Promise((r) => setTimeout(r, 4000));
  },
};
