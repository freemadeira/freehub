import type { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";

import {
  decodeMentions,
  encodeMentions,
  mentionReference,
} from "@/lib/mentions";
import type { Comment, Template } from "@/lib/model";
import {
  applyEdits,
  CARD_KIND,
  COMMENT_KIND,
  commentPeopleTags,
  deleteCommentTemplate,
  EDIT_KIND,
  editCommentTemplate,
  parseComment,
  withEdits,
} from "@/lib/model";
import { deriveNotifications } from "@/lib/notifications";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);

let clock = 1000;

function signed(template: Template, pubkey: string, time?: number): NostrEvent {
  clock += 1;
  const createdAt = time ?? clock;
  return {
    ...template,
    created_at: createdAt,
    id: `${pubkey.slice(0, 4)}${createdAt}${template.kind}`,
    pubkey,
    sig: "sig",
  };
}

/** A comment on Alice's card, told to `mentioned` and to `subscribers`. */
function comment(
  author: string,
  content: string,
  {
    mentioned = [],
    subscribers = [],
  }: { mentioned?: string[]; subscribers?: string[] } = {}
): NostrEvent {
  const address = `${CARD_KIND}:${ALICE}:card1`;
  return signed(
    {
      content,
      kind: COMMENT_KIND,
      tags: [
        ["A", address],
        ["K", String(CARD_KIND)],
        ["P", ALICE],
        ["a", address],
        ["k", String(CARD_KIND)],
        ...commentPeopleTags(author, mentioned, subscribers),
      ],
    },
    author
  );
}

function edit(
  of: Comment,
  content: string,
  by = of.author,
  time?: number
): NostrEvent {
  return signed(editCommentTemplate(of, content), by, time);
}

describe("comment edits", () => {
  it("shows the newest edit by the comment's writer", () => {
    const original = parseComment(comment(BOB, "First"));
    const first = edit(original, "Second");
    const second = edit(original, "Third");
    const [edited] = applyEdits([original], [second, first]);
    expect(edited?.content).toBe("Third");
    expect(edited?.editedAt).toBe(second.created_at);
    expect(edited?.edits.map((each) => each.id)).toEqual([first.id, second.id]);
    expect(edited?.id).toBe(original.id);
  });

  it("ignores edits by anyone else, and blank ones", () => {
    const original = parseComment(comment(BOB, "Mine"));
    const [edited] = applyEdits(
      [original],
      [edit(original, "Hijacked", ALICE), edit(original, "  ")]
    );
    expect(edited).toBe(original);
    expect(edited?.editedAt).toBeUndefined();
  });

  it("settles edits made in the same second the same way every time", () => {
    const original = parseComment(comment(BOB, "Text"));
    const one = { ...edit(original, "One", BOB, 5000), id: "1" };
    const two = { ...edit(original, "Two", BOB, 5000), id: "2" };
    expect(applyEdits([original], [one, two])[0]?.content).toBe("Two");
    expect(applyEdits([original], [two, one])[0]?.content).toBe("Two");
  });

  it("gives events the edited text, keeping their id", () => {
    const event = comment(BOB, "Before");
    const changed = edit(parseComment(event), "After");
    const [edited] = withEdits([event], [changed]);
    expect(edited?.content).toBe("After");
    expect(edited?.id).toBe(event.id);
  });

  it("leaves activity entries as they were, even edited by their writer", () => {
    const base = comment(BOB, "Logged a call");
    const activity = { ...base, tags: [...base.tags, ["activity", "call"]] };
    const changed = edit(parseComment(activity), "Rewritten");
    expect(withEdits([activity], [changed])).toEqual([activity]);
    expect(applyEdits([parseComment(activity)], [changed])[0]?.content).toBe(
      "Logged a call"
    );
  });

  it("deletes a comment's edits along with it", () => {
    const original = parseComment(comment(BOB, "Text"));
    const changed = edit(original, "Edited");
    const [edited] = applyEdits([original], [changed]);
    expect(edited && deleteCommentTemplate(edited).tags).toEqual([
      ["e", original.id],
      ["e", changed.id],
      ["k", String(COMMENT_KIND)],
      ["k", String(EDIT_KIND)],
    ]);
    expect(deleteCommentTemplate(original).tags).toEqual([
      ["e", original.id],
      ["k", String(COMMENT_KIND)],
    ]);
  });
});

describe("decodeMentions", () => {
  const names = new Map([
    [BOB, "Bob"],
    [CAROL, "Carol Ann"],
  ]);

  it("gives back the text as typed, which encodes to the same content", () => {
    const content = `Hi ${mentionReference(BOB)} and ${mentionReference(CAROL)}, see ${mentionReference(BOB)}.`;
    const { text, picked } = decodeMentions(content, names);
    expect(text).toBe("Hi @Bob and @Carol Ann, see @Bob.");
    expect(picked).toEqual([
      { name: "Bob", pubkey: BOB },
      { name: "Carol Ann", pubkey: CAROL },
    ]);
    expect(encodeMentions(text, picked)).toBe(content);
  });

  it("keeps a mention it has no name for, or one glued to a word", () => {
    const content = `${mentionReference(ALICE)} and ${mentionReference(BOB)}s`;
    const { text, picked } = decodeMentions(content, names);
    expect(text).toBe(content);
    expect(picked).toEqual([]);
  });
});

describe("news of an edited comment", () => {
  it("stays a mention while it still mentions them", () => {
    const event = comment(BOB, `Hey ${mentionReference(CAROL)}`, {
      mentioned: [CAROL],
    });
    const changed = edit(
      parseComment(event),
      `Hey ${mentionReference(CAROL)}, fixed`
    );
    const [news] = deriveNotifications(withEdits([event], [changed]), CAROL);
    expect(news).toMatchObject({
      content: `Hey ${mentionReference(CAROL)}, fixed`,
      id: event.id,
      reason: "mention",
    });
  });

  it("is a comment to a subscriber it no longer mentions", () => {
    const event = comment(BOB, `Hey ${mentionReference(CAROL)}`, {
      mentioned: [CAROL],
      subscribers: [CAROL],
    });
    const changed = edit(parseComment(event), "Hey all");
    const [news] = deriveNotifications(withEdits([event], [changed]), CAROL);
    expect(news).toMatchObject({
      content: "Hey all",
      direct: false,
      id: event.id,
      reason: "comment",
    });
  });

  it("goes for someone it no longer mentions who doesn't follow the card", () => {
    const event = comment(BOB, `Hey ${mentionReference(CAROL)}`, {
      mentioned: [CAROL],
    });
    const changed = edit(parseComment(event), "Hey all");
    expect(deriveNotifications(withEdits([event], [changed]), CAROL)).toEqual(
      []
    );
  });
});
