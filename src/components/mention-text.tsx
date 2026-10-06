import { Fragment } from "react";

import { useProfile } from "@/hooks/use-profile";
import { splitMentions } from "@/lib/mentions";

function MentionChip({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return (
    <span className="bg-primary/20 rounded-md px-1 font-medium">@{name}</span>
  );
}

/** Comment text with each mention shown as the person's name. */
export function MentionText({ content }: { content: string }) {
  // Segments never reorder for the same content, so their index is a stable key.
  return splitMentions(content).map((segment, index) => (
    <Fragment key={index}>
      {segment.type === "text" ? (
        segment.text
      ) : (
        <MentionChip pubkey={segment.pubkey} />
      )}
    </Fragment>
  ));
}
