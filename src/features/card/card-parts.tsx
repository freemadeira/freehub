import { cn } from "cn";
import type { ReactNode } from "react";
import { Fragment } from "react";

import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { UserAvatar } from "@/components/user-avatar";
import { LABEL_COLORS } from "@/features/card/card-fields";
import { useProfile } from "@/hooks/use-profile";
import type { Label } from "@/lib/model";

const STACKED = 3;

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export function LabelDot({ label }: { label: Label }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 rounded-full bg-current", LABEL_COLORS[label])}
    />
  );
}

function PersonName({ pubkey }: { pubkey: string }) {
  return useProfile(pubkey).name;
}

export function Person({ pubkey }: { pubkey: string }) {
  return (
    <>
      <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
      <span className="truncate">
        <PersonName pubkey={pubkey} />
      </span>
    </>
  );
}

/** Stacked avatars of the first few people, then a count. */
export function AvatarStack({
  pubkeys,
  surface = "card",
  className,
}: {
  pubkeys: string[];
  /** What the stack sits on, so the rings between avatars match it. */
  surface?: "card" | "popover";
  className?: string;
}) {
  const hidden = pubkeys.length - STACKED;
  const onPopover = surface === "popover";
  return (
    <AvatarGroup
      className={cn(
        "-space-x-1",
        onPopover && "*:data-[slot=avatar]:ring-popover",
        className
      )}
    >
      {pubkeys.slice(0, STACKED).map((pubkey) => (
        <UserAvatar key={pubkey} pubkey={pubkey} size="xs" />
      ))}
      {hidden > 0 && (
        <AvatarGroupCount
          className={cn("size-5 text-[0.625rem]", onPopover && "ring-popover")}
        >
          +{hidden}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  );
}

/** Assignees as a value: one person by name, several as avatars and names. */
export function People({ pubkeys }: { pubkeys: string[] }) {
  const [only] = pubkeys;
  if (!only) {
    return <Muted>Unassigned</Muted>;
  }
  if (pubkeys.length === 1) {
    return <Person pubkey={only} />;
  }
  return (
    <>
      <AvatarStack className="shrink-0" pubkeys={pubkeys} surface="popover" />
      <span className="truncate">
        {pubkeys.map((pubkey, index) => (
          <Fragment key={pubkey}>
            {index > 0 && ", "}
            <PersonName pubkey={pubkey} />
          </Fragment>
        ))}
      </span>
    </>
  );
}
