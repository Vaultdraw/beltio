export default {
  activate(ctx) {
    ctx.commands.register("boom", () => {
      throw new Error("kaboom");
    });
  },
};
