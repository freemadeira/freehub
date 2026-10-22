import { cn } from "cn";
import { format, parseISO } from "date-fns";
import {
  ArrowUpIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { TimelineTime } from "@/components/timeline";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { AddReaction, Reactions } from "@/features/card/reactions";
import { Backlinks } from "@/features/catalogs/backlinks";
import type { ShownLink } from "@/features/catalogs/catalog-context";
import { useCatalog } from "@/features/catalogs/catalog-context";
import { CategoryPicker } from "@/features/catalogs/category-picker";
import { CategoryChip } from "@/features/catalogs/link-parts";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { useProfile } from "@/hooks/use-profile";
import { useThreadReactions } from "@/hooks/use-reactions";
import {
  acceptSuggestion,
  addLinkComment,
  deleteLinkComment,
  hasReader,
  resetLink,
  updateLink,
} from "@/lib/catalog-actions";
import type { LinkType } from "@/lib/catalogs";
import {
  hostOf,
  LINK_TYPE_NAMES,
  LINK_TYPES,
  linkAddresses,
  MAX_LINK_CATEGORIES,
  MAX_NOTE,
} from "@/lib/catalogs";
import { formatDuration } from "@/lib/drive";
import type { Mention } from "@/lib/mentions";
import { encodeMentions } from "@/lib/mentions";
import type { Comment } from "@/lib/model";
import { LINK_KIND } from "@/lib/model";
import type { Reaction } from "@/lib/reactions";
import {
  commentReactionTarget,
  linkReactionTarget,
  NO_REACTIONS,
} from "@/lib/reactions";
import type { PickedRef } from "@/lib/refs";
import { encodeRefs } from "@/lib/refs";

const APPLE = /Mac|iPhone|iPad/u.test(navigator.userAgent);
const NO_COMMENTS: Comment[] = [];

/**
 * Text that becomes a field when pressed, for whoever can edit: saved on
 * Enter (⌘↵ for longer text) or on leaving it, and set back on Escape.
 */
function InlineText({
  value,
  onSave,
  multiline = false,
  placeholder,
  editable,
  className,
  label,
  maxLength,
  children,
}: {
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  placeholder: string;
  editable: boolean;
  className?: string;
  label: string;
  maxLength?: number;
  /** How the value shows while it isn't being edited. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== undefined;

  useEffect(() => {
    if (editing) {
      const element = field.current;
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    }
  }, [editing]);

  const save = () => {
    if (draft !== undefined && draft.trim() !== value.trim()) {
      onSave(draft.trim());
    }
    setDraft(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      setDraft(undefined);
    } else if (
      event.key === "Enter" &&
      (!multiline || event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      save();
    }
  };

  if (editing) {
    return (
      <textarea
        aria-label={label}
        className={cn(
          "bg-foreground/5 focus-visible:ring-ring/40 -mx-2 field-sizing-content w-[calc(100%+1rem)] resize-none rounded-lg px-2 py-1 outline-none focus-visible:ring-2",
          className
        )}
        maxLength={maxLength}
        onBlur={save}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={field}
        rows={1}
        value={draft}
      />
    );
  }
  if (!editable) {
    return value ? <div className={className}>{children ?? value}</div> : null;
  }
  return (
    <button
      aria-label={value ? `Edit ${label.toLowerCase()}` : label}
      className={cn(
        "hover:bg-foreground/5 focus-visible:ring-ring/40 -mx-2 w-[calc(100%+1rem)] cursor-text rounded-lg px-2 py-1 text-left transition-colors duration-150 outline-none focus-visible:ring-2",
        !value && "text-muted-foreground",
        className
      )}
      onClick={() => setDraft(value)}
      type="button"
    >
      {value ? (children ?? value) : placeholder}
    </button>
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

/** The link's categories, with a way to change them and the ones suggested. */
function Categories({ link }: { link: ShownLink }) {
  const { catalog, project, categories, canEdit } = useCatalog();
  const known = link.categories.flatMap((id) => {
    const category = categories.get(id);
    return category ? [category] : [];
  });
  let pickerLabel = "Add";
  if (known.length === 0) {
    pickerLabel = "Add category";
  } else if (known.length >= MAX_LINK_CATEGORIES) {
    pickerLabel = "Change";
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {known.map((category) => (
        <CategoryChip
          category={category}
          className="h-6 pr-1 text-xs"
          key={category.id}
        >
          {canEdit && (
            <button
              aria-label={`Take out of ${category.name}`}
              className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full transition-colors duration-150"
              onClick={() =>
                updateLink(project, link, {
                  categories: link.categories.filter(
                    (id) => id !== category.id
                  ),
                })
              }
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </CategoryChip>
      ))}
      {canEdit &&
        link.suggested.map((name) => (
          <button
            className="text-muted-foreground hover:text-foreground hover:border-primary/60 hover:bg-primary/5 flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-xs transition-colors duration-150"
            key={name}
            onClick={() => acceptSuggestion(project, catalog, name)}
            title="Suggested by the AI. Add it as a category."
            type="button"
          >
            <SparklesIcon aria-hidden className="text-primary size-3" />
            {name}
            <PlusIcon aria-hidden className="size-3" />
          </button>
        ))}
      {canEdit && (
        <CategoryPicker
          aria-label="Categories"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 data-popup-open:bg-foreground/5 flex h-6 items-center gap-1 rounded-full px-2 text-xs transition-colors duration-150 outline-none"
          onChange={(ids) => {
            if (ids.length > MAX_LINK_CATEGORIES) {
              return;
            }
            updateLink(project, link, { categories: ids });
          }}
          value={link.categories}
        >
          <PlusIcon aria-hidden className="size-3.5" />
          {pickerLabel}
        </CategoryPicker>
      )}
      {!canEdit && known.length === 0 && (
        <span className="text-muted-foreground text-sm">No category</span>
      )}
    </div>
  );
}

/** How long, when and where: what the page says about the link, and who saved it. */
function Details({ link }: { link: ShownLink }) {
  const { canEdit, project } = useCatalog();
  return (
    <dl className="flex flex-col divide-y">
      <Detail label="Type">
        {canEdit ? (
          <Select
            items={LINK_TYPES.map((type) => ({
              label: LINK_TYPE_NAMES[type],
              value: type,
            }))}
            onValueChange={(next: LinkType | null) => {
              if (next && next !== link.type) {
                updateLink(project, link, { type: next });
              }
            }}
            value={link.type}
          >
            <SelectTrigger
              aria-label="Type"
              className="hover:bg-foreground/5 -mr-2 h-7 border-0 bg-transparent px-2 shadow-none dark:bg-transparent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {LINK_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {LINK_TYPE_NAMES[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          LINK_TYPE_NAMES[link.type]
        )}
      </Detail>
      {link.byline && (
        <Detail label="By">
          {link.byline.url ? (
            <a
              className="decoration-foreground/30 hover:decoration-foreground truncate underline underline-offset-3 transition-[text-decoration-color] duration-150"
              href={link.byline.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {link.byline.name}
            </a>
          ) : (
            <span className="truncate">{link.byline.name}</span>
          )}
        </Detail>
      )}
      {link.publishedAt && (
        <Detail label="Published">
          {format(parseISO(link.publishedAt), "PP")}
        </Detail>
      )}
      {link.duration ? (
        <Detail label="Length">
          <span className="tabular-nums">{formatDuration(link.duration)}</span>
        </Detail>
      ) : null}
      <Detail label="Site">
        <PlatformIcon className="size-3.5" platform={link.platform} />
        <a
          className="decoration-foreground/30 hover:decoration-foreground truncate underline underline-offset-3 transition-[text-decoration-color] duration-150"
          href={link.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {hostOf(link.url)}
        </a>
      </Detail>
      <Detail label="Saved by">
        <UserAvatar aria-hidden pubkey={link.savedBy} size="xs" />
        <span className="truncate">
          <PersonName pubkey={link.savedBy} />
        </span>
        <span className="text-muted-foreground">·</span>
        <TimelineTime at={link.savedAt} />
      </Detail>
    </dl>
  );
}

/** Reactions to the link, or to one of its comments, and a way to add one. */
function ReactionRow({
  reactions,
  target,
}: {
  reactions: Reaction[];
  target: Parameters<typeof Reactions>[0]["target"];
}) {
  const { me, canEdit } = useCatalog();
  if (!canEdit && reactions.length === 0) {
    return null;
  }
  return (
    <div className="-ml-1 flex flex-wrap items-center gap-1 has-[>ul:first-child]:ml-0">
      <FluidTooltip.Group>
        <Reactions
          canEdit={canEdit}
          me={me}
          reactions={reactions}
          target={target}
        />
        {canEdit && (
          <AddReaction
            className="size-7 rounded-full"
            reactions={reactions}
            target={target}
          />
        )}
      </FluidTooltip.Group>
    </div>
  );
}

function Composer({ link }: { link: ShownLink }) {
  const { me, project } = useCatalog();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [refs, setRefs] = useState<PickedRef[]>([]);
  const [sending, setSending] = useState(false);
  const ready = !sending && text.trim() !== "";

  const send = async () => {
    if (!ready) {
      return;
    }
    setSending(true);
    const sent = await addLinkComment(
      link,
      encodeRefs(encodeMentions(text.trim(), mentions), refs)
    );
    setSending(false);
    if (sent) {
      setText("");
      setMentions([]);
      setRefs([]);
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
        onMention={(mention) => setMentions([...mentions, mention])}
        onRef={(ref) => setRefs([...refs, ref])}
        onValueChange={setText}
        // Anyone on the project, viewers too, can be pointed at the link.
        people={[...project.members, ...project.viewers].filter(
          (person) => person !== me
        )}
        placeholder="Comment… @ to mention, # to link"
        readOnly={sending}
        refs={{ project: project.address }}
        rows={1}
        value={text}
      />
      <IconButton
        disabled={!ready}
        label="Send"
        onMouseDown={(event) => event.preventDefault()}
        tooltip={`Send ${APPLE ? "⌘↵" : "Ctrl+Enter"}`}
        type="submit"
        variant={ready || sending ? "default" : "secondary"}
      >
        <ArrowUpIcon />
      </IconButton>
    </form>
  );
}

/** What people said about the link, with their reactions. */
function Comments({
  comments,
  reactions,
}: {
  comments: Comment[];
  reactions: ReadonlyMap<string, Reaction[]>;
}) {
  const { me, canEdit } = useCatalog();
  if (comments.length === 0) {
    return null;
  }
  return (
    <ol className="flex flex-col gap-2.5">
      {comments.map((comment) => (
        <li
          className={cn(
            "group/comment bg-card shadow-surface flex flex-col gap-1.5 rounded-xl p-3 transition-opacity duration-200",
            !comment.event.sig && "opacity-60"
          )}
          key={comment.id}
        >
          <div className="flex h-6 items-center gap-2">
            <UserAvatar aria-hidden pubkey={comment.author} size="sm" />
            <span className="truncate text-sm font-medium">
              <PersonName pubkey={comment.author} />
            </span>
            <TimelineTime at={comment.createdAt} />
            {canEdit && comment.author === me && comment.event.sig && (
              <IconButton
                className="ml-auto opacity-0 transition-opacity duration-150 group-hover/comment:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                label="Delete comment"
                onClick={() => deleteLinkComment(comment)}
                size="icon-xs"
              >
                <Trash2Icon />
              </IconButton>
            )}
          </div>
          <p className="text-sm wrap-break-word whitespace-pre-wrap">
            <MentionText content={comment.content} />
          </p>
          <ReactionRow
            reactions={reactions.get(comment.id) ?? NO_REACTIONS}
            target={commentReactionTarget(comment)}
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * Everything about a link beside its preview: its title and summary, which
 * whoever can edit changes in place, its categories, its note, where it's
 * referenced, and what people said about it.
 */
export function LinkPanel({
  link,
  comments = NO_COMMENTS,
  className,
}: {
  link: ShownLink;
  comments?: Comment[];
  className?: string;
}) {
  const { canEdit, project } = useCatalog();
  const reading = link.state === "reading";
  const reactions = useThreadReactions(
    {
      addresses: linkAddresses(project, link),
      id: link.id,
      key: `${project.event.id}:${link.id}`,
      kind: LINK_KIND,
      members: project.members,
    },
    comments
  );
  return (
    <aside
      aria-label="Details and comments"
      className={cn(
        "bg-popover text-popover-foreground shadow-raised flex min-h-0 flex-col rounded-2xl",
        className
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <section className="flex flex-col gap-2">
          <InlineText
            className="text-lg leading-snug font-semibold text-pretty"
            editable={canEdit}
            label="Title"
            onSave={(title) => {
              if (title) {
                updateLink(project, link, { title });
              }
            }}
            placeholder="Title"
            value={link.title}
          />
          {link.originalTitle && (
            <p className="text-muted-foreground text-xs text-pretty">
              Originally “{link.originalTitle}”
            </p>
          )}
          {reading ? (
            <output
              aria-label="Reading the page"
              className="flex flex-col gap-1.5 py-1"
            >
              <span className="link-reading block h-3.5 rounded-full" />
              <span className="link-reading block h-3.5 w-4/5 rounded-full" />
            </output>
          ) : (
            <InlineText
              className="text-muted-foreground text-sm leading-relaxed text-pretty"
              editable={canEdit}
              label="Summary"
              multiline
              onSave={(summary) => updateLink(project, link, { summary })}
              placeholder="Add a summary…"
              value={link.summary}
            />
          )}
          <Categories link={link} />
          {canEdit &&
            link.edited.length > 0 &&
            !reading &&
            link.reading &&
            hasReader() && (
              <button
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start text-xs transition-colors duration-150"
                onClick={() => resetLink(project, link)}
                type="button"
              >
                <WandSparklesIcon aria-hidden className="size-3.5" />
                Edited by hand · Let the AI fill it in again
              </button>
            )}
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Note</h3>
          <InlineText
            className="text-sm leading-relaxed whitespace-pre-wrap"
            editable={canEdit}
            label="Note"
            maxLength={MAX_NOTE}
            multiline
            onSave={(note) => updateLink(project, link, { note })}
            placeholder="Add a note, like why it’s worth keeping…"
            value={link.note}
          />
          {!(canEdit || link.note) && (
            <p className="text-muted-foreground text-sm">No note.</p>
          )}
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Details</h3>
          <Details link={link} />
        </section>

        <Backlinks link={link} />

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            Comments
            {comments.length > 0 && (
              <span className="text-muted-foreground ml-1.5 font-normal tabular-nums">
                {comments.length}
              </span>
            )}
          </h3>
          <ReactionRow
            reactions={reactions.get(link.id) ?? NO_REACTIONS}
            target={linkReactionTarget(project, link)}
          />
          <Comments comments={comments} reactions={reactions} />
        </section>
      </div>
      {canEdit && (
        <div className="border-t p-3">
          <Composer link={link} />
        </div>
      )}
    </aside>
  );
}
