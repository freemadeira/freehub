/** Status icons after Linear's: a ring while the work is open, a disc once it's closed. */

import type { LucideIconNode } from "lucide-react";
import { createLucideIcon } from "lucide-react";

const RING: LucideIconNode = [
  "circle",
  { cx: 12, cy: 12, key: "ring", r: 9.75, strokeWidth: 2.5 },
];

/** A ring with a pie inside, filled as far as the work has come. */
function ring(name: string, pie: string) {
  return createLucideIcon({
    name,
    node: [
      RING,
      ["path", { d: pie, fill: "currentColor", key: "pie", stroke: "none" }],
    ],
  });
}

const DISC = "M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22Z";

/** A filled disc with a mark cut out of it, so the mark shows what's behind. */
function disc(name: string, mark: string) {
  return createLucideIcon({
    name,
    node: [
      [
        "path",
        {
          clipRule: "evenodd",
          d: `${DISC}${mark}`,
          fill: "currentColor",
          fillRule: "evenodd",
          key: "disc",
          stroke: "none",
        },
      ],
    ],
  });
}

export const StatusTriageIcon = disc(
  "status-triage",
  "M5.75 12L9.25 8.5V10.75H14.75V8.5L18.25 12L14.75 15.5V13.25H9.25V15.5Z"
);

/** Twelve dashes around the ring. */
export const StatusBacklogIcon = createLucideIcon({
  name: "status-backlog",
  node: [
    [
      "circle",
      {
        cx: 12,
        cy: 12,
        key: "ring",
        r: 9.75,
        strokeDasharray: "2.3 2.8",
        strokeDashoffset: 1.15,
        strokeLinecap: "butt",
        strokeWidth: 2.5,
        transform: "rotate(-90 12 12)",
      },
    ],
  ],
});

export const StatusTodoIcon = createLucideIcon({
  name: "status-todo",
  node: [RING],
});

export const StatusProgressIcon = ring(
  "status-progress",
  "M12 5.5A6.5 6.5 0 0 1 12 18.5Z"
);

export const StatusReviewIcon = ring(
  "status-review",
  "M12 12V5.5A6.5 6.5 0 1 1 5.5 12Z"
);

export const StatusDoneIcon = disc(
  "status-done",
  "M8.38 11.37L10.5 13.48L15.62 8.37A1.25 1.25 0 0 1 17.38 10.13L11.38 16.13A1.25 1.25 0 0 1 9.62 16.13L6.62 13.13A1.25 1.25 0 0 1 8.38 11.37Z"
);

export const StatusCanceledIcon = disc(
  "status-canceled",
  "M13.77 12L16.6 14.83A1.25 1.25 0 0 1 14.83 16.6L12 13.77L9.17 16.6A1.25 1.25 0 0 1 7.4 14.83L10.23 12L7.4 9.17A1.25 1.25 0 0 1 9.17 7.4L12 10.23L14.83 7.4A1.25 1.25 0 0 1 16.6 9.17Z"
);

/** Two strokes, as in a pair of the same. */
export const StatusDuplicateIcon = disc(
  "status-duplicate",
  "M8.89 13.48L13.48 8.89A1.25 1.25 0 0 0 11.72 7.12L7.12 11.72A1.25 1.25 0 0 0 8.89 13.48ZM12.28 16.88L16.88 12.28A1.25 1.25 0 0 0 15.11 10.52L10.52 15.11A1.25 1.25 0 0 0 12.28 16.88Z"
);
