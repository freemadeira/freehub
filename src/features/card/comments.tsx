import { getDisplayName } from "applesauce-core/helpers/profile";
import { cn } from "cn";
import { format } from "date-fns";
import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { TimelineMarker, TimelineTime } from "@/components/timeline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { UserAvatar } from "@/components/user-avatar";
import { useBoard } from "@/features/board/board-context";
import { AddReaction, Reactions } from "@/features/card/reactions";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { useProfile } from "@/hooks/use-profile";
import { addComment, deleteComment, editComment } from "@/lib/actions";
import { draftFields, draftKey, draftText } from "@/lib/drafts";
import type { Mention } from "@/lib/mentions";
import { decodeMentions, encodeMentions, mentionNames } from "@/lib/mentions";
import type { Board, Card, Comment } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { PROFILE_KIND } from "@/lib/profiles";
import type { Reaction } from "@/lib/reactions";
import { commentReactionTarget, NO_REACTIONS } from "@/lib/reactions";
import type { PickedRef } from "@/lib/refs";
import { encodeRefs } from "@/lib/refs";
import { shortNpub } from "@/lib/utils";

export interface Draft {
  text: string;
  /** Who was picked from the list, so their `@Name` still mentions them. */
  picked: Mention[];
  /** What was picked to reference, so its `#Label` still goes to it. */
  refs: PickedRef[];
}

/** Anyone who can read the card, viewers too, can be pointed at it. */
function mentionable(board: Board, me: string): string[] {
  return [...board.members, ...board.viewers].filter((person) => person !== me);
}

/** The comment as the draft it was typed as, with its mentions back to `@Name`. */
function draftOf(comment: Comment, people: string[]): Draft {
  const names = mentionNames(
    people,
    new Map(
      people.map((pubkey) => [
        pubkey,
        getDisplayName(eventStore.getReplaceable(PROFILE_KIND, pubkey)) ||
          shortNpub(pubkey),
      ])
    )
  );
  return { ...decodeMentions(comment.content, names), refs: [] };
}

/** What the draft saves as: picked mentions and references in their place. */
function encodeDraft({ text, picked, refs }: Draft): string {
  return encodeRefs(encodeMentions(text.trim(), picked), refs);
}

function DeleteCommentDialog({
  comment,
  open,
  onOpenChange,
}: {
  comment: Comment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete comment?</AlertDialogTitle>
          <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteComment(comment)}
            variant="destructive"
          >
            Delete comment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Your comment's ⋯ menu: editing it, or deleting it. */
function CommentMenu({
  saving,
  onEdit,
  onDelete,
  trigger,
}: {
  /**
   * An edit is still at the signer. Deleting waits for it, so the deletion
   * can name it and its text doesn't outlive the comment on the relay.
   */
  saving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** The ⋯ button, which focus comes back to after an edit. */
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        render={
          <IconButton label="More" size="icon-xs">
            <EllipsisIcon />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <PencilIcon />
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={saving}
          onClick={onDelete}
          variant="destructive"
        >
          <Trash2Icon />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Your comment being edited where it is. Escape leaves it as it was;
 * Mod+Enter saves. The comment shows its new text at once.
 */
function CommentEditor({
  comment,
  initial,
  onDone,
}: {
  comment: Comment;
  /** The comment's text as it's typed, with who it mentions. */
  initial: Draft;
  onDone: () => void;
}) {
  const { board, pubkey } = useBoard();
  const [draft, setDraft] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  const content = encodeDraft(draft);
  const changed = content !== comment.content;

  // It opens with the caret after the text, to write on, focused as it
  // mounts so a phone raises its keyboard for the tap that opened it.
  useLayoutEffect(() => {
    const field = form.current?.querySelector("textarea");
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, []);

  const save = () => {
    if (!content) {
      return;
    }
    if (changed) {
      editComment(comment, content);
    }
    onDone();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  // Escape anywhere in it leaves the edit. Not while text is being composed;
  // the `@` and `#` lists close on their own first.
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.stopPropagation();
      onDone();
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from any of its controls, which bubbles up to it
    <form
      className="flex flex-col gap-2"
      onKeyDown={onFormKeyDown}
      onSubmit={submit}
      ref={form}
    >
      <MentionTextarea
        aria-label="Edit comment"
        className="min-h-16"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (changed) {
              save();
            } else {
              onDone();
            }
          }
        }}
        onMention={(mention) =>
          setDraft((current) => ({
            ...current,
            picked: [...current.picked, mention],
          }))
        }
        onRef={(ref) =>
          setDraft((current) => ({ ...current, refs: [...current.refs, ref] }))
        }
        onValueChange={(value) =>
          setDraft((current) => ({ ...current, text: value }))
        }
        people={mentionable(board, pubkey)}
        refs={{ project: board.project }}
        value={draft.text}
      />
      <div className="flex justify-end gap-1">
        <Button onClick={onDone} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!(changed && content)} size="sm" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * A comment on the card's timeline: who wrote it, when, what, and the
 * reactions to it. Its writer can edit or delete it.
 */
export function CommentEntry({
  comment,
  own,
  reactions = NO_REACTIONS,
}: {
  comment: Comment;
  own: boolean;
  reactions?: Reaction[];
}) {
  const { board, canEdit, pubkey } = useBoard();
  const { name } = useProfile(comment.author);
  const [editing, setEditing] = useState<Draft>();
  const [deleting, setDeleting] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  // Reacting, editing and deleting go by the comment's id, so wait for it.
  const signed = comment.event.sig !== "";
  const saving = !signed || comment.edits.at(-1)?.sig === "";
  const mine = canEdit && own;
  const target = commentReactionTarget(comment);

  // Focused within the tap that opened it, so a phone raises its keyboard.
  const edit = () =>
    flushSync(() => setEditing(draftOf(comment, mentionable(board, pubkey))));

  // Leaving the edit puts focus back on the comment's menu, where it was.
  const done = () => {
    flushSync(() => setEditing(undefined));
    menu.current?.focus();
  };

  return (
    <li
      className={cn(
        "group/comment flex gap-3 transition-opacity duration-200",
        saving && "opacity-60"
      )}
    >
      <TimelineMarker>
        <UserAvatar aria-hidden pubkey={comment.author} size="sm" />
      </TimelineMarker>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <TimelineTime at={comment.createdAt} />
          {comment.editedAt !== undefined && (
            <span
              className="text-muted-foreground shrink-0 text-xs"
              title={`Edited ${format(comment.editedAt * 1000, "PPpp")}`}
            >
              (edited)
            </span>
          )}
          {canEdit && signed && !editing && (
            // Shown on hover, and kept while the emoji picker or the menu is open.
            <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/comment:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
              <FluidTooltip.Group>
                <AddReaction
                  reactions={reactions}
                  size="icon-xs"
                  target={target}
                />
                {mine && (
                  <CommentMenu
                    onDelete={() => setDeleting(true)}
                    onEdit={edit}
                    saving={saving}
                    trigger={menu}
                  />
                )}
              </FluidTooltip.Group>
            </div>
          )}
        </div>
        {editing ? (
          <CommentEditor comment={comment} initial={editing} onDone={done} />
        ) : (
          <p className="bg-card shadow-surface rounded-xl p-3 text-sm wrap-break-word whitespace-pre-wrap">
            <MentionText content={comment.content} />
          </p>
        )}
        <FluidTooltip.Group>
          <Reactions
            canEdit={canEdit}
            me={pubkey}
            reactions={reactions}
            target={target}
          />
        </FluidTooltip.Group>
      </div>
      {mine && (
        <DeleteCommentDialog
          comment={comment}
          onOpenChange={setDeleting}
          open={deleting}
        />
      )}
    </li>
  );
}

function isMention(value: unknown): value is Mention {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "pubkey" in value &&
    typeof value.pubkey === "string"
  );
}

function isPickedRef(value: unknown): value is PickedRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string" &&
    "url" in value &&
    typeof value.url === "string"
  );
}

export function parseDraft(saved: unknown): Draft {
  const fields = draftFields(saved);
  return {
    picked: Array.isArray(fields.picked) ? fields.picked.filter(isMention) : [],
    // Missing from drafts kept before things could be referenced.
    refs: Array.isArray(fields.refs) ? fields.refs.filter(isPickedRef) : [],
    text: draftText(fields.text),
  };
}

export function isEmptyDraft({ text }: Draft): boolean {
  return text.trim() === "";
}

export function Composer({ card }: { card: Card }) {
  const { board, pubkey } = useBoard();
  // Kept when the card closes, until it's sent.
  const [draft, setDraft] = useLocalDraft(
    draftKey(pubkey, "comment", card.id),
    parseDraft,
    isEmptyDraft
  );
  const { text } = draft;

  const send = () => {
    const content = encodeDraft(draft);
    if (content) {
      addComment(board, card, content);
      setDraft({ picked: [], refs: [], text: "" });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <MentionTextarea
        aria-label="Comment"
        className="min-h-16"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
        onMention={(mention) =>
          setDraft((current) => ({
            ...current,
            picked: [...current.picked, mention],
          }))
        }
        onRef={(ref) =>
          setDraft((current) => ({ ...current, refs: [...current.refs, ref] }))
        }
        onValueChange={(value) =>
          setDraft((current) => ({ ...current, text: value }))
        }
        people={mentionable(board, pubkey)}
        placeholder="Add a comment… Type @ to mention someone, # to link."
        refs={{ project: board.project }}
        value={text}
      />
      {text.trim() && (
        <Button className="self-end" size="sm" type="submit">
          Comment
        </Button>
      )}
    </form>
  );
}
