import { cn } from "cn";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Trash2Icon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
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
import { UserAvatar } from "@/components/user-avatar";
import { useBoard } from "@/features/board/board-context";
import { useComments } from "@/hooks/use-comments";
import { useProfile } from "@/hooks/use-profile";
import { addComment, deleteComment } from "@/lib/actions";
import { inboxStore } from "@/lib/inbox";
import type { Mention } from "@/lib/mentions";
import { encodeMentions, mentions } from "@/lib/mentions";
import type { Card, Comment } from "@/lib/model";

function ago(date: Date): string {
  return Date.now() - date.getTime() < 60_000
    ? "Just now"
    : formatDistanceToNowStrict(date, { addSuffix: true });
}

function DeleteComment({ comment }: { comment: Comment }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        className="ml-auto opacity-0 transition-opacity duration-150 group-hover/comment:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        label="Delete comment"
        onClick={() => setOpen(true)}
        size="icon-xs"
      >
        <Trash2Icon />
      </IconButton>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This can’t be undone.
            </AlertDialogDescription>
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
    </>
  );
}

function CommentItem({ comment, own }: { comment: Comment; own: boolean }) {
  const { name } = useProfile(comment.author);
  const date = new Date(comment.createdAt * 1000);
  const signed = comment.event.sig !== "";
  return (
    <li
      className={cn(
        "group/comment flex gap-3 transition-opacity duration-200",
        !signed && "opacity-60"
      )}
    >
      <UserAvatar
        aria-hidden
        className="mt-0.5"
        pubkey={comment.author}
        size="sm"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex h-6 items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          <time
            className="text-muted-foreground shrink-0 text-xs"
            dateTime={date.toISOString()}
            title={format(date, "PPpp")}
          >
            {ago(date)}
          </time>
          {own && signed && <DeleteComment comment={comment} />}
        </div>
        <p className="wrap-break-word whitespace-pre-wrap">
          <MentionText content={comment.content} />
        </p>
      </div>
    </li>
  );
}

function Composer({ card }: { card: Card }) {
  const { board, pubkey } = useBoard();
  const [text, setText] = useState("");
  // Who was picked from the list, read only when sending.
  const picked = useRef<Mention[]>([]);

  const send = () => {
    const content = encodeMentions(text.trim(), picked.current);
    if (content) {
      addComment(card, content);
      setText("");
      picked.current = [];
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
        onMention={(mention) => {
          picked.current = [...picked.current, mention];
        }}
        onValueChange={setText}
        people={board.members.filter((member) => member !== pubkey)}
        placeholder="Add a comment… Type @ to mention someone."
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

export function Comments({
  card,
  className,
}: {
  card: Card;
  className?: string;
}) {
  const id = useId();
  const { board, pubkey } = useBoard();
  const comments = useComments(board, card);

  // Seeing the card counts as reading the mentions of you in it.
  const mentionKey = comments
    .filter(
      (comment) =>
        comment.author !== pubkey && mentions(comment.content, pubkey)
    )
    .map((comment) => comment.id)
    .join(",");
  useEffect(() => {
    if (mentionKey) {
      inboxStore(pubkey).setRead(mentionKey.split(","), true);
    }
  }, [mentionKey, pubkey]);

  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-4", className)}
    >
      <h3 className="flex items-center gap-2 font-medium" id={id}>
        Comments
        {comments.length > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {comments.length}
          </span>
        )}
      </h3>
      {comments.length > 0 && (
        <ol className="flex flex-col gap-4">
          {comments.map((comment) => (
            <CommentItem
              comment={comment}
              key={comment.id}
              own={comment.author === pubkey}
            />
          ))}
        </ol>
      )}
      <Composer card={card} />
    </section>
  );
}
