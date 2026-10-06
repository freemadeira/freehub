import { CollisionPriority } from "@dnd-kit/abstract";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "cn";
import { CalendarIcon } from "lucide-react";
import { Link } from "wouter";

import { UserAvatar } from "@/components/user-avatar";
import { CARD_SURFACE } from "@/features/board/card-surface";
import { QuickAdd } from "@/features/board/quick-add";
import { useCardDrag } from "@/features/board/use-card-drag";
import { useCrm } from "@/features/crm/crm-context";
import { OPENED_FROM_TABLE } from "@/features/crm/records-view";
import { OptionChip } from "@/features/crm/values";
import type { CrmRecord, Field, FieldOption } from "@/lib/crm";
import {
  findOption,
  firstValue,
  recordTitle,
  stageField,
  titleField,
} from "@/lib/crm";
import { createRecord, updateRecord } from "@/lib/crm-actions";
import { formatCurrency, formatDay, toNumber } from "@/lib/crm-values";
import { rankBetween } from "@/lib/model";
import { SWATCH_COLORS } from "@/lib/palette";

/** Column for records whose stage is unset or was removed. */
const NO_STAGE = "none";

function firstOfType(fields: Field[], type: Field["type"]): Field | undefined {
  return fields.find((field) => field.type === type);
}

function CardMeta({ record }: { record: CrmRecord }) {
  const { table } = useCrm();
  const currency = firstOfType(table.fields, "currency");
  const select = firstOfType(table.fields, "select");
  const date = firstOfType(table.fields, "date");
  const member = firstOfType(table.fields, "member");
  const amount = currency
    ? toNumber(firstValue(record, currency.id))
    : undefined;
  const option = select
    ? findOption(select, firstValue(record, select.id))
    : undefined;
  const day = date ? firstValue(record, date.id) : undefined;
  const owner = member ? firstValue(record, member.id) : undefined;
  if (amount === undefined && !option && !day && !owner) {
    return null;
  }
  return (
    <span className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
      {amount !== undefined && currency && (
        <span className="text-xs font-medium">
          {formatCurrency(amount, currency.config || "EUR")}
        </span>
      )}
      {option && <OptionChip className="h-5" option={option} />}
      {day && date && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <CalendarIcon aria-hidden className="size-3.5" />
          <span className="sr-only">{date.name}</span>
          <time dateTime={day}>{formatDay(day, "MMM d")}</time>
        </span>
      )}
      {owner && <UserAvatar className="ml-auto" pubkey={owner} size="xs" />}
    </span>
  );
}

function RecordCard({
  record,
  group,
  index,
}: {
  record: CrmRecord;
  group: string;
  index: number;
}) {
  const { recordHref } = useCrm();
  const { ref } = useSortable({
    accept: "card",
    group,
    id: record.id,
    index,
    type: "card",
  });
  return (
    <Link
      className={cn(CARD_SURFACE, "flex flex-col gap-2.5 p-3 select-none")}
      draggable={false}
      href={recordHref(record)}
      ref={ref}
      // dnd-kit turns draggables without a role into buttons; these navigate.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="link"
      state={OPENED_FROM_TABLE}
    >
      <span
        className={cn(
          "line-clamp-3 text-sm leading-snug",
          !record.title && "text-muted-foreground"
        )}
      >
        {recordTitle(record)}
      </span>
      <CardMeta record={record} />
    </Link>
  );
}

interface ColumnProps {
  id: string;
  option?: FieldOption;
  records: CrmRecord[];
  onAdd: (title: string) => void;
}

function Column({ id, option, records, onAdd }: ColumnProps) {
  const { table } = useCrm();
  const { ref } = useDroppable({
    accept: "card",
    collisionPriority: CollisionPriority.Low,
    id,
    type: "column",
  });
  const currency = firstOfType(table.fields, "currency");
  const total = currency
    ? records.reduce(
        (sum, record) => sum + (toNumber(firstValue(record, currency.id)) ?? 0),
        0
      )
    : 0;
  return (
    <section
      className="bg-muted/60 flex flex-col gap-2 rounded-2xl p-2"
      ref={ref}
    >
      <h3 className="flex h-8 items-center gap-2 px-1.5 text-sm font-medium">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            SWATCH_COLORS[option?.color ?? "gray"]
          )}
        />
        <span className="truncate">{option?.label ?? "No stage"}</span>
        <span className="text-muted-foreground tabular-nums">
          {records.length}
        </span>
        {currency && total !== 0 && (
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {formatCurrency(total, currency.config || "EUR")}
          </span>
        )}
      </h3>
      {records.map((record, index) => (
        <RecordCard group={id} index={index} key={record.id} record={record} />
      ))}
      <QuickAdd
        label={`Add ${table.singular.toLowerCase()}`}
        onAdd={onAdd}
        placeholder={titleField(table).name}
      />
    </section>
  );
}

export function PipelineView() {
  const { records, table } = useCrm();
  const stage = stageField(table);
  const groups: Record<string, CrmRecord[]> = { [NO_STAGE]: [] };
  for (const option of stage?.options ?? []) {
    groups[option.id] = [];
  }
  for (const record of records) {
    const value = stage ? firstValue(record, stage.id) : undefined;
    (groups[value ?? NO_STAGE] ?? groups[NO_STAGE])?.push(record);
  }
  const drag = useCardDrag<string, CrmRecord>(groups, (moves) => {
    if (!stage) {
      return;
    }
    for (const { card, group, rank } of moves) {
      updateRecord(table, card, {
        rank,
        values: {
          ...card.values,
          [stage.id]: group === NO_STAGE ? [] : [group],
        },
      });
    }
  });

  if (!stage) {
    return null;
  }

  const add = (group: string, title: string) => {
    const column = drag.groups[group] ?? [];
    createRecord(table, {
      rank: rankBetween(column.at(-1)?.rank),
      title,
      values: group === NO_STAGE ? {} : { [stage.id]: [group] },
    });
  };

  const columns = [
    ...((drag.groups[NO_STAGE]?.length ?? 0) > 0
      ? [{ id: NO_STAGE, option: undefined }]
      : []),
    ...stage.options.map((option) => ({ id: option.id, option })),
  ];

  return (
    <DragDropProvider {...drag.props}>
      <div className="-mx-4 grid grow auto-cols-[minmax(17rem,1fr)] grid-flow-col items-start gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
        {columns.map(({ id, option }) => (
          <Column
            id={id}
            key={id}
            onAdd={(title) => add(id, title)}
            option={option}
            records={drag.groups[id] ?? []}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}
