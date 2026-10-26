import { useEffect } from "react";

/**
 * Renders nothing; calls `run` once it mounts (and again if `run` changes).
 * Marks a view that needs a lazily started service, such as the home page's
 * recent drawings under `files.list_start = "use"`.
 */
export const OnMount = ({ run }: { run: () => void }) => {
  useEffect(() => {
    run();
  }, [run]);
  return null;
};
