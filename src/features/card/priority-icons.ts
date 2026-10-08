import type { LucideIconNode } from "lucide-react";
import { createLucideIcon } from "lucide-react";

/** Bars of signal strength: as many lit as the priority is high, the rest dimmed. */
function bars(name: string, lit: number) {
  const node: LucideIconNode[] = [8, 13, 18].map((height, index) => [
    "rect",
    {
      fill: "currentColor",
      fillOpacity: index < lit ? 1 : 0.35,
      height,
      key: `bar-${index}`,
      rx: 1.5,
      stroke: "none",
      width: 4.5,
      x: 2.25 + index * 7.5,
      y: 21 - height,
    },
  ]);
  return createLucideIcon({ name, node });
}

/** A filled square with an exclamation mark cut out of it. */
export const PriorityUrgentIcon = createLucideIcon({
  name: "priority-urgent",
  node: [
    [
      "path",
      {
        clipRule: "evenodd",
        d: "M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4ZM12 5.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 3 0V7a1.5 1.5 0 0 0-1.5-1.5ZM12 15a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 1 0 0-3.5Z",
        fill: "currentColor",
        fillRule: "evenodd",
        key: "square",
        stroke: "none",
      },
    ],
  ],
});
export const PriorityHighIcon = bars("priority-high", 3);
export const PriorityMediumIcon = bars("priority-medium", 2);
export const PriorityLowIcon = bars("priority-low", 1);

/** Three dashes where the bars would stand: no priority set. */
export const PriorityNoneIcon = createLucideIcon({
  name: "priority-none",
  node: [0, 1, 2].map((index): LucideIconNode => [
    "rect",
    {
      fill: "currentColor",
      height: 2,
      key: `dash-${index}`,
      rx: 1,
      stroke: "none",
      width: 4.5,
      x: 2.25 + index * 7.5,
      y: 11,
    },
  ]),
});
