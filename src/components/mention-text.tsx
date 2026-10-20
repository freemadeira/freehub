import { Fragment } from "react";

import { AppLink } from "@/components/app-link";
import { useProfile } from "@/hooks/use-profile";
import { splitLinks } from "@/lib/links";
import { splitMentions } from "@/lib/mentions";

function MentionChip({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return (
    <span className="bg-primary/20 rounded-md px-1 font-medium">@{name}</span>
  );
}

/**
 * Comment text with each mention shown as the person's name and each address
 * linked; addresses in the app show what they go to. Inside another link,
 * `interactive` is false and they show without links of their own.
 */
export function MentionText({
  content,
  interactive = true,
}: {
  content: string;
  interactive?: boolean;
}) {
  // Segments never reorder for the same content, so their index is a stable key.
  return splitMentions(content).map((segment, index) => (
    <Fragment key={index}>
      {segment.type === "text" ? (
        splitLinks(segment.text).map((part, at) =>
          part.type === "text" ? (
            part.text
          ) : (
            <AppLink href={part.url} interactive={interactive} key={at} />
          )
        )
      ) : (
        <MentionChip pubkey={segment.pubkey} />
      )}
    </Fragment>
  ));
}
