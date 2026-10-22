/** The shell's command runner (palette path), registered by VaultApp. */
type Runner = (id: string) => boolean;

let runner: Runner | null = null;

export const setAppCommandRunner = (fn: Runner | null): void => {
  runner = fn;
};

export const getAppCommandRunner = (): Runner | null => runner;
