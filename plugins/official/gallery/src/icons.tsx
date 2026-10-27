/** The two tile placeholder icons (Lucide "folder" and "pencil-line"), as the app's own. */
import type { SVGProps } from "react";

const stroke = (path: string) => (props: SVGProps<SVGSVGElement>) =>
  (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={path} />
    </svg>
  );

export const IconFolder = stroke(
  "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
);
export const IconDrawing = stroke(
  "M12 20h9M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6l-4 1 1-4z",
);
