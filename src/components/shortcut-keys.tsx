import { Fragment } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { Keys } from "@/lib/shortcuts";
import { keySteps, keysText } from "@/lib/shortcuts";

/** A shortcut's keys as key caps, with "then" between the steps of a sequence. */
export function ShortcutKeys({
  keys,
  className,
}: {
  keys: Keys;
  className?: string;
}) {
  return (
    <KbdGroup className={className}>
      <span className="sr-only">{keysText(keys)}</span>
      {keySteps(keys).map((step, index) => (
        // Steps can repeat, like G then G; their place tells them apart.
        // oxlint-disable-next-line react/no-array-index-key
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden className="text-muted-foreground px-0.5 text-xs">
              then
            </span>
          )}
          {step.map((key) => (
            <Kbd aria-hidden key={key}>
              {key}
            </Kbd>
          ))}
        </Fragment>
      ))}
    </KbdGroup>
  );
}

/** A tooltip's label with its shortcut after it, in the tooltip's quieter tone. */
export function KeyHint({ label, keys }: { label: string; keys: Keys }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <kbd className="text-background/60 font-sans">{keysText(keys)}</kbd>
    </span>
  );
}
