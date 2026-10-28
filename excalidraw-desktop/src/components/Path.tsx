import "./Path.css";

/**
 * A file path on one line: the folder part shortens with "…" when the box is
 * narrow, the file name never does and never breaks mid-word (Finder, VS Code
 * breadcrumbs). The full path is the hover text, and selecting it copies the
 * whole path because both parts are real text.
 */
export const Path = ({
  path,
  className,
}: {
  path: string;
  className?: string;
}) => {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  return (
    <code
      className={`vd-path vault-config-path${className ? ` ${className}` : ""}`}
      title={path}
      data-path={path}
    >
      <span className="vd-path__dir vault-config-path__dir">
        {path.slice(0, cut)}
      </span>
      <span className="vd-path__file vault-config-path__file">
        {path.slice(cut)}
      </span>
    </code>
  );
};

/** True for text that reads as a file path (has a folder separator). */
export const looksLikePath = (text: string) => /[/\\]/.test(text);
