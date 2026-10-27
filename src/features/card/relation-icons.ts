/** Icons for a card held up by others, and for one holding others up. */

import { createLucideIcon } from "lucide-react";

/** A disc with a bar cut out of it, like a no-entry sign. */
export const BlockedIcon = createLucideIcon({
  name: "blocked",
  node: [
    [
      "path",
      {
        clipRule: "evenodd",
        d: "M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22ZM6.5 10.5H17.5V13.5H6.5Z",
        fill: "currentColor",
        fillRule: "evenodd",
        key: "disc",
        stroke: "none",
      },
    ],
  ],
});

/** A card with a dot on its corner: something is waiting on it. */
export const BlockingIcon = createLucideIcon({
  name: "blocking",
  node: [
    [
      "path",
      {
        d: "M11.5 18.75H5.75A3.5 3.5 0 0 1 2.25 15.25V5.75A3.5 3.5 0 0 1 5.75 2.25H15.25A3.5 3.5 0 0 1 18.75 5.75V11.5",
        key: "card",
        strokeWidth: 2.5,
      },
    ],
    [
      "circle",
      {
        cx: 18.5,
        cy: 18.5,
        fill: "currentColor",
        key: "dot",
        r: 4.5,
        stroke: "none",
      },
    ],
  ],
});
