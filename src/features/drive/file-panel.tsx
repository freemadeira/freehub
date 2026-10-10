import { cn } from "cn";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowUpIcon, Trash2Icon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { UserAvatar } from "@/components/user-avatar";
import { isEmptyDraft, parseDraft } from "@/features/card/comments";
import { useDrive } from "@/features/drive/drive-state";
import { FolderIcon } from "@/features/drive/file-icon";
import { useFileComments } from "@/hooks/use-drive";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { useProfile } from "@/hooks/use-profile";
import { draftKey } from "@/lib/drafts";
import type { DriveFile } from "@/lib/drive";
import { fileKind, formatDuration, KIND_LABELS } from "@/lib/drive";
import { addFileComment, deleteFileComment } from "@/lib/drive-actions";
import { encodeMentions } from "@/lib/mentions";
import type { Comment as FileComment } from "@/lib/model";
import { formatBytes } from "@/lib/utils";

const APPLE = /Mac|iPhone|iPad/u.test(navigator.userAgent);

function ago(ms: number): string {
  return Date.now() - ms < 60_000
    ? "Just now"
    : formatDistanceToNowStrict(ms, { addSuffix: true });
}

/** When something happened, from its time in seconds, like "2 days ago". */
function When({ at }: { at: number }) {
  const ms = at * 1000;
  return (
    <time
      className="text-muted-foreground shrink-0 text-xs"
      dateTime={new Date(ms).toISOString()}
      title={format(ms, "PPpp")}
    >
      {ago(ms)}
    </time>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 truncate text-right">
        {children}
      </dd>
    </div>
  );
}

function PersonName({ pubkey }: { pubkey: string }) {
  return useProfile(pubkey).name;
}

function Details({ file }: { file: DriveFile }) {
  const { tree } = useDrive();
  const folder = file.folder ? tree.byId.get(file.folder) : undefined;
  const added = file.createdAt * 1000;
  return (
    <dl className="flex flex-col divide-y">
      <Detail label="Kind">{KIND_LABELS[fileKind(file)]}</Detail>
      <Detail label="Size">
        <span className="tabular-nums">{formatBytes(file.size)}</span>
      </Detail>
      {file.width && file.height && (
        <Detail label="Dimensions">
          <span className="tabular-nums">
            {file.width} × {file.height}
          </span>
        </Detail>
      )}
      {file.duration && (
        <Detail label="Length">
          <span className="tabular-nums">{formatDuration(file.duration)}</span>
        </Detail>
      )}
      <Detail label="Where">
        <FolderIcon folder={folder} size="sm" />
        <span className="truncate">{folder?.name ?? "Drive"}</span>
      </Detail>
      <Detail label="Added by">
        <UserAvatar aria-hidden pubkey={file.creator} size="xs" />
        <span className="truncate">
          <PersonName pubkey={file.creator} />
        </span>
      </Detail>
      <Detail label="Added">
        <span title={format(added, "PPpp")}>{format(added, "PP")}</span>
      </Detail>
    </dl>
  );
}

/** Who uploaded the file, and when: where its story starts. */
function Uploaded({ file }: { file: DriveFile }) {
  return (
    <li className="text-muted-foreground flex items-start gap-2.5 text-sm">
      <UserAvatar
        aria-hidden
        className="mt-px"
        pubkey={file.creator}
        size="xs"
      />
      <p className="min-w-0 flex-1">
        <span className="text-foreground font-medium">
          <PersonName pubkey={file.creator} />
        </span>{" "}
        uploaded this · <When at={file.createdAt} />
      </p>
    </li>
  );
}

function Comment({ comment }: { comment: FileComment }) {
  const { pubkey, canEdit } = useDrive();
  const signed = comment.event.sig !== "";
  return (
    <li
      className={cn(
        "group/comment bg-card shadow-surface flex flex-col gap-1.5 rounded-xl p-3 transition-opacity duration-200",
        !signed && "opacity-60"
      )}
    >
      <div className="flex h-6 items-center gap-2">
        <UserAvatar aria-hidden pubkey={comment.author} size="sm" />
        <span className="truncate text-sm font-medium">
          <PersonName pubkey={comment.author} />
        </span>
        <When at={comment.createdAt} />
        {canEdit && signed && comment.author === pubkey && (
          <IconButton
            className="ml-auto opacity-0 transition-opacity duration-150 group-hover/comment:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            label="Delete comment"
            onClick={() => deleteFileComment(comment)}
            size="icon-xs"
          >
            <Trash2Icon />
          </IconButton>
        )}
      </div>
      <p className="text-sm wrap-break-word whitespace-pre-wrap">
        <MentionText content={comment.content} />
      </p>
    </li>
  );
}

function Composer({ file }: { file: DriveFile }) {
  const { pubkey, project } = useDrive();
  // Kept when the preview closes, until it's sent.
  const [{ text, picked }, setDraft] = useLocalDraft(
    draftKey(pubkey, "file-comment", file.id),
    parseDraft,
    isEmptyDraft
  );
  const ready = text.trim() !== "";

  const send = () => {
    const content = encodeMentions(text.trim(), picked);
    if (content) {
      addFileComment(file, content);
      setDraft({ picked: [], text: "" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  return (
    <form
      className="bg-card shadow-surface flex items-end gap-1 rounded-xl p-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <MentionTextarea
        aria-label="Comment"
        className="min-h-9 flex-1 rounded-none border-0 bg-transparent px-2 py-1.5 focus-visible:ring-0 dark:bg-transparent"
        onKeyDown={onKeyDown}
        onMention={(mention) =>
          setDraft((draft) => ({
            ...draft,
            picked: [...draft.picked, mention],
          }))
        }
        onValueChange={(value) =>
          setDraft((draft) => ({ ...draft, text: value }))
        }
        // Anyone who can see the Drive, viewers too, can be pointed at the file.
        people={[...project.members, ...project.viewers].filter(
          (person) => person !== pubkey
        )}
        placeholder="Comment… @ to mention"
        rows={1}
        value={text}
      />
      <IconButton
        disabled={!ready}
        label="Send"
        onMouseDown={(event) => event.preventDefault()}
        tooltip={`Send ${APPLE ? "⌘↵" : "Ctrl+Enter"}`}
        type="submit"
        variant={ready ? "default" : "secondary"}
      >
        <ArrowUpIcon />
      </IconButton>
    </form>
  );
}

/** A file's details, who added it and what people said about it. */
export function FilePanel({
  file,
  className,
}: {
  file: DriveFile;
  className?: string;
}) {
  const { canEdit, project } = useDrive();
  const comments = useFileComments(project, file);
  return (
    <aside
      aria-label="Details and comments"
      className={cn(
        "bg-popover text-popover-foreground shadow-raised flex min-h-0 flex-col rounded-2xl",
        className
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Details</h3>
          <Details file={file} />
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Activity</h3>
          <ol className="flex flex-col gap-3">
            <Uploaded file={file} />
            {comments.map((comment) => (
              <Comment comment={comment} key={comment.id} />
            ))}
          </ol>
        </section>
      </div>
      {canEdit && (
        <div className="border-t p-3">
          <Composer file={file} key={file.id} />
        </div>
      )}
    </aside>
  );
}
