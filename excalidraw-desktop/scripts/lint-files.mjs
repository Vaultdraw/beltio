// Drops the files ESLint would ignore (.eslintignore). ESLint 7 prints "File ignored because of a
// matching ignore pattern" for them, and `--max-warnings=0` turns that warning into a failure.
// ESLint loads only when there is a file to check.
export async function lintableFiles(files, cwd) {
  if (!files.length) {
    return [];
  }
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd });
  const kept = [];
  for (const file of files) {
    if (!(await eslint.isPathIgnored(file))) {
      kept.push(file);
    }
  }
  return kept;
}
