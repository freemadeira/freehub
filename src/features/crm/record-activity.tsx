import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClockIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneCallIcon,
  PlusIcon,
  StickyNoteIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react";
import type { FormEvent } from "react";
import { Fragment, useId, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { Timeline, TimelineMarker, TimelineTime } from "@/components/timeline";
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
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UserAvatar } from "@/components/user-avatar";
import type { Draft as MessageDraft } from "@/features/card/comments";
import { parseDraft as parseMessageDraft } from "@/features/card/comments";
import { useCrm } from "@/features/crm/crm-context";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { useProfile } from "@/hooks/use-profile";
import { useRecordActivity } from "@/hooks/use-record-activity";
import type {
  Activity,
  ActivityType,
  Assignment,
  CrmRecord,
  StageMove,
} from "@/lib/crm";
import { ACTIVITY_TYPES, findOption, stageField } from "@/lib/crm";
import { addActivity, deleteActivity } from "@/lib/crm-actions";
import { draftFields, draftKey } from "@/lib/drafts";
import { encodeMentions } from "@/lib/mentions";
import { SWATCH_COLORS } from "@/lib/palette";

const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  call: PhoneCallIcon,
  email: MailIcon,
  meeting: CalendarClockIcon,
  message: MessageSquareIcon,
  note: StickyNoteIcon,
  visit: MapPinIcon,
};

const ACTIVITY_VERBS: Record<ActivityType, string> = {
  call: "logged a call",
  email: "logged an email",
  meeting: "logged a meeting",
  message: "logged a message",
  note: "added a note",
  visit: "logged a visit",
};

type Entry =
  | { kind: "activity"; at: number; activity: Activity }
  | { kind: "assigned"; at: number; assignment: Assignment }
  | { kind: "move"; at: number; move: StageMove }
  | { kind: "created"; at: number; by?: string };

function ProfileName({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return <span className="font-medium">{name}</span>;
}

function Name({ pubkey }: { pubkey?: string }) {
  return pubkey ? (
    <ProfileName pubkey={pubkey} />
  ) : (
    <span className="font-medium">Someone</span>
  );
}

function DeleteActivity({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        className="ml-auto opacity-0 transition-opacity duration-150 group-hover/entry:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        label="Delete"
        onClick={() => setOpen(true)}
        size="icon-xs"
      >
        <Trash2Icon />
      </IconButton>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteActivity(activity)}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ActivityEntry({ activity }: { activity: Activity }) {
  const { pubkey } = useCrm();
  const Icon = ACTIVITY_ICONS[activity.type];
  const signed = activity.event.sig !== "";
  return (
    <li
      className={cn(
        "group/entry flex gap-3 transition-opacity duration-200",
        !signed && "opacity-60"
      )}
    >
      <TimelineMarker>
        <UserAvatar aria-hidden pubkey={activity.author} size="sm" />
      </TimelineMarker>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2">
          <span className="text-sm">
            <Name pubkey={activity.author} />{" "}
            <span className="text-muted-foreground">
              {ACTIVITY_VERBS[activity.type]}
            </span>
          </span>
          <TimelineTime at={activity.createdAt} />
          {activity.author === pubkey && signed && (
            <DeleteActivity activity={activity} />
          )}
        </div>
        <div className="bg-card shadow-surface flex gap-2.5 rounded-xl p-3">
          <Icon
            aria-hidden
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
          <p className="min-w-0 text-sm wrap-break-word whitespace-pre-wrap">
            <MentionText content={activity.content} />
          </p>
        </div>
      </div>
    </li>
  );
}

function MoveEntry({ move }: { move: StageMove }) {
  const { table } = useCrm();
  const field = stageField(table);
  const option = field ? findOption(field, move.stage) : undefined;
  return (
    <li className="flex items-center gap-3">
      <TimelineMarker>
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full",
            SWATCH_COLORS[option?.color ?? "gray"]
          )}
        />
      </TimelineMarker>
      <span className="min-w-0 flex-1 text-sm">
        <Name pubkey={move.by} />{" "}
        <span className="text-muted-foreground">moved it to</span>{" "}
        <span className="font-medium">
          {option?.label ?? "a removed stage"}
        </span>
      </span>
      <TimelineTime at={move.at} />
    </li>
  );
}

function AssignedEntry({ assignment }: { assignment: Assignment }) {
  const { table } = useCrm();
  const field = table.fields.find(({ id }) => id === assignment.field);
  return (
    <li className="flex items-center gap-3">
      <TimelineMarker>
        <UserPlusIcon aria-hidden className="text-muted-foreground size-4" />
      </TimelineMarker>
      <span className="min-w-0 flex-1 text-sm">
        <Name pubkey={assignment.author} />{" "}
        <span className="text-muted-foreground">assigned</span>{" "}
        {assignment.people.map((pubkey, index) => (
          <Fragment key={pubkey}>
            {index > 0 && (
              <span className="text-muted-foreground">
                {index === assignment.people.length - 1 ? " and " : ", "}
              </span>
            )}
            <ProfileName pubkey={pubkey} />
          </Fragment>
        ))}
        {field && (
          <>
            {" "}
            <span className="text-muted-foreground">as</span>{" "}
            <span className="font-medium">{field.name}</span>
          </>
        )}
      </span>
      <TimelineTime at={assignment.createdAt} />
    </li>
  );
}

function CreatedEntry({ at, by }: { at: number; by?: string }) {
  const { table } = useCrm();
  return (
    <li className="flex items-center gap-3">
      <TimelineMarker>
        <PlusIcon aria-hidden className="text-muted-foreground size-4" />
      </TimelineMarker>
      <span className="min-w-0 flex-1 text-sm">
        <Name pubkey={by} />{" "}
        <span className="text-muted-foreground">
          added this {table.singular.toLowerCase()}
        </span>
      </span>
      <TimelineTime at={at} />
    </li>
  );
}

type Draft = MessageDraft & { type: ActivityType };

function parseDraft(saved: unknown): Draft {
  const fields = draftFields(saved);
  return {
    ...parseMessageDraft(saved),
    type: ACTIVITY_TYPES.find((item) => item.id === fields.type)?.id ?? "note",
  };
}

function isEmptyDraft({ text }: Draft): boolean {
  return text.trim() === "";
}

function Composer({ record }: { record: CrmRecord }) {
  const id = useId();
  const { project, pubkey } = useCrm();
  // Kept when the record closes, until it's logged.
  const [{ type, text, picked }, setDraft] = useLocalDraft(
    draftKey(pubkey, "activity", record.id),
    parseDraft,
    isEmptyDraft
  );
  const label =
    ACTIVITY_TYPES.find((item) => item.id === type)?.label ?? "Note";

  const send = () => {
    const content = encodeMentions(text.trim(), picked);
    if (content) {
      addActivity(record, type, content);
      setDraft((draft) => ({ ...draft, picked: [], text: "" }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <ToggleGroup
        aria-label="Kind of entry"
        className="gap-0.5"
        onValueChange={(next) => {
          const chosen = ACTIVITY_TYPES.find((item) => item.id === next[0]);
          if (chosen) {
            setDraft((draft) => ({ ...draft, type: chosen.id }));
          }
        }}
        value={[type]}
      >
        <FluidTooltip.Group>
          {ACTIVITY_TYPES.map((item) => {
            const Icon = ACTIVITY_ICONS[item.id];
            return (
              <FluidTooltip.Root key={item.id}>
                <FluidTooltip.Trigger>
                  <ToggleGroupItem
                    aria-label={item.label}
                    className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-pressed:bg-foreground/8 data-pressed:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors duration-150 [&_svg]:size-4"
                    value={item.id}
                  >
                    <Icon />
                  </ToggleGroupItem>
                </FluidTooltip.Trigger>
                <FluidTooltip.Content>{item.label}</FluidTooltip.Content>
              </FluidTooltip.Root>
            );
          })}
        </FluidTooltip.Group>
      </ToggleGroup>
      <MentionTextarea
        aria-label={label}
        className="min-h-16"
        id={id}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
        onMention={(mention) =>
          setDraft((draft) => ({
            ...draft,
            picked: [...draft.picked, mention],
          }))
        }
        onValueChange={(value) =>
          setDraft((draft) => ({ ...draft, text: value }))
        }
        // Anyone who can read the record, viewers too, can be pointed at it.
        people={[...project.members, ...project.viewers].filter(
          (person) => person !== pubkey
        )}
        placeholder={
          type === "note"
            ? "Add a note…"
            : `What happened on this ${label.toLowerCase()}?`
        }
        value={text}
      />
      {text.trim() && (
        <Button className="self-end" size="sm" type="submit">
          Log {label.toLowerCase()}
        </Button>
      )}
    </form>
  );
}

export function RecordActivity({
  record,
  className,
}: {
  record: CrmRecord;
  className?: string;
}) {
  const id = useId();
  const { canEdit, project, table } = useCrm();
  const { activity, assignments } = useRecordActivity(project, table, record);
  const created: Entry = {
    at: record.createdAt,
    by: record.creator,
    kind: "created",
  };
  const entries = [
    ...activity.map((item): Entry => ({
      activity: item,
      at: item.createdAt,
      kind: "activity",
    })),
    ...assignments.map((assignment): Entry => ({
      assignment,
      at: assignment.createdAt,
      kind: "assigned",
    })),
    ...record.moves.map((move): Entry => ({ at: move.at, kind: "move", move })),
    created,
  ].toSorted((a, b) => b.at - a.at);

  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-4", className)}
    >
      <h3 className="flex items-center gap-2 font-medium" id={id}>
        Activity
        {activity.length > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {activity.length}
          </span>
        )}
      </h3>
      {canEdit && <Composer record={record} />}
      <Timeline>
        {entries.map((entry) => {
          if (entry.kind === "activity") {
            return (
              <ActivityEntry
                activity={entry.activity}
                key={entry.activity.id}
              />
            );
          }
          if (entry.kind === "assigned") {
            return (
              <AssignedEntry
                assignment={entry.assignment}
                key={entry.assignment.id}
              />
            );
          }
          if (entry.kind === "move") {
            return (
              <MoveEntry
                key={`${entry.move.stage}:${entry.move.at}`}
                move={entry.move}
              />
            );
          }
          return <CreatedEntry at={entry.at} by={entry.by} key="created" />;
        })}
      </Timeline>
    </section>
  );
}
