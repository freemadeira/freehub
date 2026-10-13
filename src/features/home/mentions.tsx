import { use } from "react";
import { Link } from "wouter";

import { Section } from "@/components/page-section";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InboxContext } from "@/features/inbox/inbox-context";
import { INBOX_PATH, InboxRow } from "@/features/inbox/inbox-page";
import type { InboxGroup, InboxItem } from "@/hooks/use-inbox";

/** Mentions shown before the inbox takes over. */
const SHOWN = 5;

/** Whether someone named the person: in a comment, a description, a page, a file or a note. */
function isMention({ notification }: InboxItem): boolean {
  switch (notification.type) {
    case "card": {
      return (
        notification.reason === "mention" ||
        notification.reason === "description"
      );
    }
    case "record": {
      return notification.reason === "mention";
    }
    default: {
      return true;
    }
  }
}

/** The group told by its newest mention, leaving its other news to the inbox. */
function mentionsIn(group: InboxGroup): InboxGroup | undefined {
  const items = group.items.filter(isMention);
  const [latest] = items;
  return latest
    ? { ...group, items, latest, read: items.every((item) => item.read) }
    : undefined;
}

/** The newest mentions of the person, as the inbox shows them. */
export function Mentions({ pubkey }: { pubkey: string }) {
  const inbox = use(InboxContext);
  const groups = (inbox?.groups ?? [])
    .flatMap((group) => mentionsIn(group) ?? [])
    .slice(0, SHOWN);
  if (!inbox || (inbox.loaded && groups.length === 0)) {
    return null;
  }
  return (
    <Section
      action={
        <Link
          className={buttonVariants({ size: "sm", variant: "ghost" })}
          href={INBOX_PATH}
        >
          View all
        </Link>
      }
      title="Mentions"
    >
      {groups.length > 0 ? (
        <ol aria-label="Mentions" className="-mx-2 flex flex-col gap-0.5">
          {groups.map((group) => (
            <InboxRow
              group={group}
              inbox={inbox}
              key={group.subject}
              pubkey={pubkey}
            />
          ))}
        </ol>
      ) : (
        <div aria-busy className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      )}
    </Section>
  );
}
