/** Which notes a view claims: the file name is, or ends in `.`, one of its extensions (`kanban.md`). */
export const claimsPath = (
  extensions: readonly string[],
  path: string,
): boolean => {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return extensions.some((e) => {
    const name = e.toLowerCase();
    return base === name || base.endsWith(`.${name}`);
  });
};
