import { createLucideIcon } from "lucide-react";

/** A person in a dashed ring, where an avatar would be: nobody assigned. */
export const NoAssigneeIcon = createLucideIcon({
  name: "no-assignee",
  node: [
    [
      "circle",
      {
        cx: 12,
        cy: 12,
        key: "ring",
        r: 10,
        // Twelve dashes around the ring.
        strokeDasharray: "2.62 2.62",
        strokeWidth: 1.75,
      },
    ],
    ["circle", { cx: 12, cy: 10, key: "head", r: 2.75, strokeWidth: 1.75 }],
    [
      "path",
      { d: "M7.5 18a5 5 0 0 1 9 0", key: "shoulders", strokeWidth: 1.75 },
    ],
  ],
});
