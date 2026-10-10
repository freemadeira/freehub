import { cn } from "cn";
import { CheckIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { Fragment, useId, useRef, useState } from "react";
import { Link } from "wouter";

import { CopyButton } from "@/components/copy";
import { IconButton } from "@/components/icon-button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getConfig } from "@/config";
import { useCrm } from "@/features/crm/crm-context";
import { FieldInput } from "@/features/crm/field-input";
import { FIELD_TYPE_META } from "@/features/crm/field-meta";
import { RecordActivity } from "@/features/crm/record-activity";
import { TableIcon } from "@/features/crm/table-icon";
import { FieldValue, OptionChip } from "@/features/crm/values";
import { mapPickHref } from "@/features/map/map-path";
import type { CrmRecord, Field } from "@/lib/crm";
import { firstValue, recordStage, recordTitle, stageField } from "@/lib/crm";
import { deleteRecord, setValues, updateRecord } from "@/lib/crm-actions";
import { isChecked } from "@/lib/crm-values";
import { CHIP_COLORS, SWATCH_COLORS } from "@/lib/palette";
import { recordPath } from "@/lib/paths";

const TITLE = "py-1 text-xl leading-snug font-semibold";
const FIELD_NAME =
  "text-muted-foreground flex h-8 min-w-0 items-center gap-2 font-normal";

function TitleField({ record }: { record: CrmRecord }) {
  const { table } = useCrm();
  const [draft, setDraft] = useState<string>();
  return (
    <textarea
      aria-label="Name"
      className={cn(
        TITLE,
        "placeholder:text-muted-foreground hover:not-focus:bg-foreground/5 focus-visible:ring-ring/30 -mx-2 field-sizing-content w-[calc(100%+1rem)] resize-none rounded-lg px-2 transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-3"
      )}
      onBlur={() => {
        const title = draft?.trim();
        if (title !== undefined && title !== record.title) {
          updateRecord(table, record, { title });
        }
        setDraft(undefined);
      }}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
        setDraft(event.target.value)
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder="Untitled"
      rows={1}
      value={draft ?? record.title}
    />
  );
}

/** The stages as steps; the passed ones are ticked off. */
function JourneyBar({ field, record }: { field: Field; record: CrmRecord }) {
  const { canEdit, table } = useCrm();
  const current = firstValue(record, field.id);
  const index = field.options.findIndex((option) => option.id === current);
  const ended = field.options[index]?.kind === "lost";
  return (
    <ToggleGroup
      aria-label={field.name}
      className="flex-wrap gap-1.5"
      disabled={!canEdit}
      onValueChange={(next) => {
        if (next[0]) {
          setValues(table, record, field.id, [next[0]]);
        }
      }}
      value={current ? [current] : []}
    >
      {field.options.map((option, position) => {
        const passed = !ended && position < index && option.kind === "open";
        return (
          <ToggleGroupItem
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150",
              option.id === current
                ? cn(
                    CHIP_COLORS[option.color],
                    "inset-ring inset-ring-current/20"
                  )
                : "text-muted-foreground enabled:hover:bg-foreground/5 enabled:hover:text-foreground inset-ring-border inset-ring",
              passed && "text-foreground/80"
            )}
            key={option.id}
            value={option.id}
          >
            {passed ? (
              <CheckIcon aria-hidden className="size-3" strokeWidth={2.5} />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  SWATCH_COLORS[option.color]
                )}
              />
            )}
            {option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

/** A field's value as text, for viewers of the project. */
function ReadOnlyValue({ field, record }: { field: Field; record: CrmRecord }) {
  const values = record.values[field.id] ?? [];
  let value = <FieldValue field={field} record={record} />;
  if (field.type === "checkbox") {
    value = <Checkbox checked={isChecked(values)} readOnly />;
  } else if (values.length === 0) {
    value = <span className="text-muted-foreground">Empty</span>;
  } else if (field.type === "longtext") {
    value = (
      <p className="leading-relaxed wrap-break-word whitespace-pre-wrap">
        {values[0]}
      </p>
    );
  }
  return (
    <div className="flex min-h-8 min-w-0 items-center px-2 py-1 text-sm">
      {value}
    </div>
  );
}

function Properties({
  record,
  fields,
}: {
  record: CrmRecord;
  fields: Field[];
}) {
  const id = useId();
  const { canEdit, project, table } = useCrm();
  const map = getConfig().map !== undefined;
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5">
      {fields.map((field) => {
        const Icon = FIELD_TYPE_META[field.type].icon;
        const name = (
          <>
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{field.name}</span>
          </>
        );
        return (
          <Fragment key={field.id}>
            {canEdit ? (
              <>
                <Label className={FIELD_NAME} htmlFor={`${id}-${field.id}`}>
                  {name}
                </Label>
                <FieldInput
                  field={field}
                  id={`${id}-${field.id}`}
                  onChange={(values) =>
                    setValues(table, record, field.id, values)
                  }
                  pickHref={
                    map && field.type === "location"
                      ? mapPickHref(project, table, record, field)
                      : undefined
                  }
                  values={record.values[field.id] ?? []}
                />
              </>
            ) : (
              <>
                <span className={cn(FIELD_NAME, "text-sm select-none")}>
                  {name}
                </span>
                <ReadOnlyValue field={field} record={record} />
              </>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Records elsewhere that link to this one through a relation field. */
function Related({ record }: { record: CrmRecord }) {
  const id = useId();
  const { content, project, table } = useCrm();
  const groups = content.tables.flatMap((other) =>
    other.fields
      .filter((field) => field.type === "relation" && field.config === table.id)
      .map((field) => ({
        field,
        records: (content.byTable.get(other.id) ?? []).filter((item) =>
          item.values[field.id]?.includes(record.id)
        ),
        table: other,
      }))
      .filter((group) => group.records.length > 0)
  );
  if (groups.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 className="font-medium" id={id}>
        Related
      </h3>
      {groups.map((group) => (
        <div
          className="flex flex-col gap-1"
          key={`${group.table.id}:${group.field.id}`}
        >
          <h4 className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <TableIcon className="size-3.5" icon={group.table.icon} />
            {group.table.title}
            <span className="tabular-nums">{group.records.length}</span>
          </h4>
          <ul className="flex flex-col">
            {group.records.map((item) => {
              const stage = recordStage(group.table, item);
              return (
                <li key={item.id}>
                  <Link
                    className="hover:bg-foreground/5 focus-visible:ring-ring/50 -mx-2 flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-3"
                    href={recordPath(project, group.table, item)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {recordTitle(item)}
                    </span>
                    {stage && <OptionChip dot option={stage} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function DeleteRecord({
  record,
  onDeleted,
}: {
  record: CrmRecord;
  onDeleted: () => void;
}) {
  const { table } = useCrm();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        label={`Delete ${table.singular.toLowerCase()}`}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon />
      </IconButton>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {recordTitle(record)}?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears for everyone in the project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDeleted();
                deleteRecord(table, record);
              }}
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

function RecordDetails({
  record,
  onClose,
}: {
  record: CrmRecord;
  onClose: () => void;
}) {
  const { canEdit, project, table } = useCrm();
  const stage = stageField(table);
  const fields = table.fields.filter(
    (field) => field.type !== "title" && field !== stage
  );
  return (
    <>
      <div className="flex items-center gap-0.5 px-5 pt-4 pb-1">
        <SheetTitle className="text-muted-foreground mr-auto flex min-w-0 items-center gap-2 text-sm font-normal">
          <TableIcon className="size-4 shrink-0" icon={table.icon} />
          <span className="truncate">{table.singular}</span>
        </SheetTitle>
        <FluidTooltip.Group>
          <CopyButton
            label="Copy link"
            value={
              new URL(
                recordPath(project, table, record),
                window.location.origin
              ).href
            }
          />
          {canEdit && <DeleteRecord onDeleted={onClose} record={record} />}
          <IconButton label="Close" onClick={onClose}>
            <XIcon />
          </IconButton>
        </FluidTooltip.Group>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pt-1 pb-8">
        <div className="flex flex-col gap-3">
          {canEdit ? (
            <TitleField record={record} />
          ) : (
            <p
              className={cn(
                TITLE,
                "wrap-break-word",
                !record.title && "text-muted-foreground"
              )}
            >
              {recordTitle(record)}
            </p>
          )}
          {stage && stage.options.length > 0 && (
            <JourneyBar field={stage} record={record} />
          )}
        </div>
        {fields.length > 0 && <Properties fields={fields} record={record} />}
        <Related record={record} />
        <RecordActivity record={record} />
      </div>
    </>
  );
}

interface RecordSheetProps {
  record: CrmRecord;
  open: boolean;
  onClose: () => void;
}

export function RecordSheet({ record, open, onClose }: RecordSheetProps) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <SheetContent
        className="gap-0 sm:max-w-xl"
        initialFocus={popup}
        ref={popup}
        showCloseButton={false}
      >
        <RecordDetails key={record.id} onClose={onClose} record={record} />
      </SheetContent>
    </Sheet>
  );
}
