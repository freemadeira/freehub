import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";
import { format, parseISO } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  CalendarIcon,
  ChartNoAxesColumnIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  IterationCwIcon,
  TagIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { use, useRef, useState } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/icon-button";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { BoardScope, CardPlacement } from "@/features/board/board-context";
import { BoardContext } from "@/features/board/board-context";
import {
  assignable,
  inOfferedOrder,
  labelName,
  sprintChoices,
} from "@/features/card/card-fields";
import type { Option } from "@/features/card/card-options";
import {
  LABEL_OPTIONS,
  PRIORITY_OPTIONS,
  sprintOptions,
  statusOptions,
  useOptionShortcuts,
} from "@/features/card/card-options";
import { LabelDot, People, Person } from "@/features/card/card-parts";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { createCard } from "@/lib/actions";
import { draftFields, draftKey, draftText } from "@/lib/drafts";
import type { Board, CardFields, Label } from "@/lib/model";
import { activeSprint, LABELS, nearestStatus, rankBetween } from "@/lib/model";

export type NewCardDefaults = CardPlacement &
  Pick<CardFields, "assignees"> & {
    /** The board picked at first, by address, when the dialog offers several. */
    board?: string;
  };

/** The boards a card made outside any one board can go on. */
export interface BoardChoice {
  scopes: BoardScope[];
  /** Called with the board picked, so the next card can start there. */
  onPick: (board: Board) => void;
  /** The sprint the card joins on each board: its active one, unless this says otherwise. */
  sprintOn?: (scope: BoardScope) => string | undefined;
}

type Properties = CardPlacement &
  Pick<CardFields, "assignees" | "priority" | "due" | "labels">;

/**
 * The properties as they carry over to another board: a status it uses, only
 * its people, and its active sprint, or the one the choice picks there.
 */
function onBoard(
  properties: Properties,
  scope: BoardScope,
  choice: BoardChoice
): Properties {
  const { board, content } = scope;
  return {
    ...properties,
    assignees: properties.assignees.filter((pubkey) =>
      board.members.includes(pubkey)
    ),
    sprint: choice.sprintOn
      ? choice.sprintOn(scope)
      : activeSprint(content)?.id,
    status: nearestStatus(board.statuses, properties.status),
  };
}

const PILL =
  "h-7 w-auto max-w-56 gap-1.5 rounded-full border-transparent bg-foreground/5 px-2.5 text-xs font-medium hover:bg-foreground/10 data-popup-open:bg-foreground/10 dark:bg-foreground/5 dark:hover:bg-foreground/10 [&_svg:not([class*='size-'])]:size-3.5";
// Select triggers end with a chevron; pills read as buttons without it.
const PILL_SELECT = cn(PILL, "[&>svg:last-child]:hidden");

function Placeholder({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5">
      <Icon aria-hidden />
      {children}
    </span>
  );
}

interface PillSelectProps<T> {
  label: string;
  icon: LucideIcon;
  value: T | null;
  options: Option<T | null>[];
  onChange: (value: T | null) => void;
}

function PillSelect<T>({
  label,
  icon,
  value,
  options,
  onChange,
}: PillSelectProps<T>) {
  const { onKeyDown, ...open } = useOptionShortcuts(options, onChange);
  return (
    <Select {...open} onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className={PILL_SELECT}>
        <SelectValue className="items-center gap-1.5">
          {(current: T | null) =>
            current === null ? (
              <Placeholder icon={icon}>{label}</Placeholder>
            ) : (
              options.find((option) => option.value === current)?.label
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent onKeyDown={onKeyDown}>
        {options.map((option) => (
          <SelectItem
            key={String(option.value)}
            shortcut={option.shortcut}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssigneesPill({
  people,
  value,
  onChange,
}: {
  people: string[];
  value: string[];
  onChange: (assignees: string[]) => void;
}) {
  return (
    <Select
      multiple
      onValueChange={(next: string[]) => onChange(inOfferedOrder(people, next))}
      value={value}
    >
      <SelectTrigger aria-label="Assignees" className={PILL_SELECT}>
        <SelectValue className="items-center gap-1.5">
          {(current: string[]) =>
            current.length === 0 ? (
              <Placeholder icon={UserRoundIcon}>Assignees</Placeholder>
            ) : (
              <People pubkeys={current} />
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {people.map((pubkey) => (
          <SelectItem key={pubkey} value={pubkey}>
            <Person pubkey={pubkey} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LabelsPill({
  value,
  onChange,
}: {
  value: Label[];
  onChange: (labels: Label[]) => void;
}) {
  return (
    <Select
      multiple
      onValueChange={(next: Label[]) =>
        onChange(LABELS.filter((label) => next.includes(label)))
      }
      value={value}
    >
      <SelectTrigger aria-label="Labels" className={PILL_SELECT}>
        <SelectValue className="items-center gap-1.5">
          {(current: Label[]) =>
            current.length === 0 ? (
              <Placeholder icon={TagIcon}>Labels</Placeholder>
            ) : (
              <>
                <span className="flex -space-x-0.5">
                  {current.map((label) => (
                    <LabelDot key={label} label={label} />
                  ))}
                </span>
                <span className="truncate">
                  {current.map(labelName).join(", ")}
                </span>
              </>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LABEL_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DuePill({
  value,
  onChange,
}: {
  value?: string;
  onChange: (due: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? parseISO(value) : undefined;

  const pick = (day?: Date) => {
    onChange(day && format(day, "yyyy-MM-dd"));
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label="Due date"
        className={cn(
          PILL,
          "focus-visible:ring-ring/50 flex items-center transition-colors outline-none focus-visible:ring-3"
        )}
      >
        {date ? (
          <>
            <CalendarIcon aria-hidden />
            {format(date, "MMM d")}
          </>
        ) : (
          <Placeholder icon={CalendarIcon}>Due date</Placeholder>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col gap-1 p-2">
        <Calendar
          defaultMonth={date}
          mode="single"
          onSelect={pick}
          selected={date}
        />
        {date && (
          <Button onClick={() => pick()} size="sm" variant="ghost">
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const BADGE =
  "bg-foreground/5 text-muted-foreground flex h-6 items-center rounded-md px-2 text-xs font-medium";

/** The board's code, which picks another board when the dialog offers several. */
function BoardBadge({
  board,
  scopes,
  onChange,
}: {
  board: Board;
  scopes: BoardScope[];
  onChange: (scope: BoardScope) => void;
}) {
  if (scopes.length < 2) {
    return <span className={BADGE}>{board.code}</span>;
  }
  return (
    <Select
      onValueChange={(address: string | null) => {
        const scope = scopes.find((item) => item.board.address === address);
        if (scope && scope.board !== board) {
          onChange(scope);
        }
      }}
      value={board.address}
    >
      <SelectTrigger
        aria-label="Board"
        className={cn(
          BADGE,
          "hover:bg-foreground/10 data-popup-open:bg-foreground/10 dark:bg-foreground/5 dark:hover:bg-foreground/10 w-auto gap-1 border-transparent pr-1.5 [&_svg:not([class*='size-'])]:size-3"
        )}
      >
        <SelectValue>{() => board.code}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {scopes.map(({ board: option }) => (
          <SelectItem key={option.address} value={option.address}>
            <span className="truncate">{option.title}</span>
            <span className="text-muted-foreground text-xs">{option.code}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface Draft {
  title: string;
  description: string;
}

function parseDraft(saved: unknown): Draft {
  const fields = draftFields(saved);
  return {
    description: draftText(fields.description),
    title: draftText(fields.title),
  };
}

function isEmptyDraft({ title, description }: Draft): boolean {
  return title.trim() === "" && description.trim() === "";
}

function isEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.nativeEvent.isComposing;
}

function NewCardForm({
  defaults,
  start,
  choice,
  announce,
  titleField,
  onClose,
}: {
  defaults: NewCardDefaults;
  /** The board the card starts on. */
  start: BoardScope;
  choice?: BoardChoice;
  announce: boolean;
  titleField: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(start.board.address);
  // Looked up again each time, so the content stays current as cards come in.
  const scope =
    choice?.scopes.find((item) => item.board.address === picked) ?? start;
  const { board, content, pubkey } = scope;
  // Closing the dialog keeps what was typed for next time; properties start
  // from where the card is added. Picking another board keeps both.
  const [{ title, description }, setDraft] = useLocalDraft(
    draftKey(pubkey, "new-card", choice ? "boards" : board.id),
    parseDraft,
    isEmptyDraft
  );
  // Counts the cards created here, so each next one starts with a fresh editor.
  const [created, setCreated] = useState(0);
  const [properties, setProperties] = useState<Properties>(() => {
    const { assignees, sprint, status } = defaults;
    const placed = { assignees, labels: [], sprint, status };
    return choice ? onBoard(placed, start, choice) : placed;
  });
  const [createMore, setCreateMore] = useState(false);
  const ready = title.trim() !== "";
  const sprints = sprintChoices(content.sprints, properties.sprint);

  const set = (changes: Partial<Properties>) =>
    setProperties((current) => ({ ...current, ...changes }));

  const pick = (next: BoardScope) => {
    if (!choice) {
      return;
    }
    setPicked(next.board.address);
    setProperties((current) => onBoard(current, next, choice));
    choice.onPick(next.board);
  };

  // Mod+Enter in the description passes its text, since the state it just
  // committed only updates on the next render.
  const create = (text = description) => {
    if (!ready) {
      return;
    }
    const key = `${board.code}-${content.nextNumber}`;
    createCard(board, content, {
      ...properties,
      description: text,
      rank: rankBetween(content.cards.at(-1)?.rank),
      title: title.trim(),
    });
    if (!createMore) {
      setDraft({ description: "", title: "" });
      onClose();
      if (announce) {
        toast.success(`${key} created`);
      }
      return;
    }
    // Properties carry over, so a run of similar cards is quick to enter.
    setDraft({ description: "", title: "" });
    setCreated((count) => count + 1);
    titleField.current?.focus();
    toast.success(`${key} created`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create();
  };

  return (
    <form className="flex flex-col" onSubmit={submit}>
      <div className="flex items-center gap-1.5 py-3 pr-3 pl-5">
        <BoardBadge
          board={board}
          onChange={pick}
          scopes={choice?.scopes ?? []}
        />
        <ChevronRightIcon
          aria-hidden
          className="text-muted-foreground size-3.5"
        />
        <DialogTitle className="text-sm font-medium">New card</DialogTitle>
        <IconButton className="ml-auto" label="Close" onClick={onClose}>
          <XIcon />
        </IconButton>
      </div>
      <div className="flex flex-col gap-1 px-5">
        <textarea
          aria-label="Title"
          className="placeholder:text-muted-foreground/70 field-sizing-content resize-none bg-transparent text-lg leading-snug font-semibold outline-none"
          onChange={(event) => {
            const { value } = event.target;
            setDraft((draft) => ({ ...draft, title: value }));
          }}
          // Enter creates; Shift+Enter is left alone.
          onKeyDown={(event) => {
            if (isEnter(event) && !event.shiftKey) {
              event.preventDefault();
              create();
            }
          }}
          placeholder="Card title"
          ref={titleField}
          rows={1}
          value={title}
        />
        <MarkdownEditor
          aria-label="Description"
          className="max-h-[40dvh] min-h-20 overflow-y-auto text-base leading-relaxed outline-none md:text-sm"
          key={created}
          onSubmit={create}
          onValueCommitted={(markdown) =>
            setDraft((draft) => ({ ...draft, description: markdown }))
          }
          // Anyone who can read the card, viewers too, can be pointed at it.
          people={[...board.members, ...board.viewers].filter(
            (person) => person !== pubkey
          )}
          placeholder="Add a description…"
          refs={{ project: board.project }}
          value={description}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pt-2 pb-4">
        <PillSelect
          icon={CircleDashedIcon}
          label="Status"
          onChange={(status) => {
            if (status) {
              set({ status });
            }
          }}
          options={statusOptions(board.statuses, properties.status)}
          value={properties.status}
        />
        <PillSelect
          icon={ChartNoAxesColumnIcon}
          label="Priority"
          onChange={(priority) => set({ priority: priority ?? undefined })}
          options={PRIORITY_OPTIONS}
          value={properties.priority ?? null}
        />
        <AssigneesPill
          onChange={(assignees) => set({ assignees })}
          people={assignable(board, properties.assignees)}
          value={properties.assignees}
        />
        <PillSelect
          icon={IterationCwIcon}
          label="Sprint"
          onChange={(sprint) => set({ sprint: sprint ?? undefined })}
          options={sprintOptions(sprints)}
          value={
            sprints.find((sprint) => sprint.id === properties.sprint)?.id ??
            null
          }
        />
        <DuePill onChange={(due) => set({ due })} value={properties.due} />
        <LabelsPill
          onChange={(labels) => set({ labels })}
          value={properties.labels}
        />
      </div>
      <div className="flex items-center justify-end gap-4 px-5 pb-4">
        {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the switch renders its own input */}
        <label className="text-muted-foreground flex items-center gap-2 text-sm select-none">
          <Switch checked={createMore} onCheckedChange={setCreateMore} />
          Create more
        </label>
        <Button disabled={!ready} type="submit">
          Create card
        </Button>
      </div>
    </form>
  );
}

interface NewCardDialogProps {
  defaults: NewCardDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The boards to pick from; the card goes on the board in context otherwise. */
  choice?: BoardChoice;
  /** Says each card was created, for cards added away from where they show. */
  announce?: boolean;
  /** Once it has closed, animation and all. */
  onClosed?: () => void;
  /** Where focus goes once it has closed. */
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}

export function NewCardDialog({
  defaults,
  open,
  onOpenChange,
  choice,
  announce = false,
  onClosed,
  finalFocus,
}: NewCardDialogProps) {
  const titleField = useRef<HTMLTextAreaElement>(null);
  const here = use(BoardContext);
  const start = choice
    ? (choice.scopes.find((scope) => scope.board.address === defaults.board) ??
      choice.scopes[0])
    : here;
  return (
    <Dialog
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          onClosed?.();
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-2xl gap-0 p-0"
        finalFocus={finalFocus}
        initialFocus={titleField}
        showCloseButton={false}
      >
        {start && (
          <NewCardForm
            announce={announce}
            choice={choice}
            defaults={defaults}
            onClose={() => onOpenChange(false)}
            start={start}
            titleField={titleField}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
