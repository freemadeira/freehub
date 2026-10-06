import { cn } from "cn";
import {
  addWeeks,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  startOfWeek,
} from "date-fns";
import type { ReactNode } from "react";
import { Link } from "wouter";

import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { useCrm } from "@/features/crm/crm-context";
import { OptionChip, Person } from "@/features/crm/values";
import type { CrmRecord, CrmTable, Field, FieldOption } from "@/lib/crm";
import { findOption, firstValue, recordTitle, stageField } from "@/lib/crm";
import { SWATCH_COLORS } from "@/lib/palette";

const WEEKS = 12;
const QUIET_DAYS = 30;
const DAY = 86_400;
const compact = new Intl.NumberFormat(undefined, { notation: "compact" });
const percent = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  style: "percent",
});

function nowSeconds(): number {
  return Date.now() / 1000;
}

/** Monday of the first of the last `WEEKS` weeks. */
function firstWeek(): Date {
  return startOfWeek(addWeeks(new Date(), -(WEEKS - 1)), { weekStartsOn: 1 });
}

function Card({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "bg-card shadow-surface flex flex-col gap-4 rounded-2xl p-5",
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium">{title}</h3>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bg-card shadow-surface flex flex-col gap-1 rounded-2xl p-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      {note && <span className="text-muted-foreground text-xs">{note}</span>}
    </div>
  );
}

function stageOf(field: Field, record: CrmRecord): FieldOption | undefined {
  return findOption(field, firstValue(record, field.id));
}

/** One bar per stage, in pipeline order, so drop-off reads top to bottom. */
function Funnel({
  field,
  records,
  table,
}: {
  field: Field;
  records: CrmRecord[];
  table: CrmTable;
}) {
  const rows = field.options.map((option) => ({
    count: records.filter(
      (record) => firstValue(record, field.id) === option.id
    ).length,
    option,
  }));
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <FluidTooltip.Group>
      <ul className="flex flex-col gap-2.5">
        {rows.map(({ option, count }) => {
          const share = records.length > 0 ? count / records.length : 0;
          const label = `${option.label}: ${count} ${(count === 1 ? table.singular : table.title).toLowerCase()}, ${percent.format(share)}`;
          return (
            <li
              className="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3"
              key={option.id}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    SWATCH_COLORS[option.color]
                  )}
                />
                <span className="truncate">{option.label}</span>
              </span>
              <FluidTooltip.Root>
                <FluidTooltip.Trigger>
                  <div className="group/bar flex h-6 items-center gap-2">
                    <span
                      className="bg-foreground/70 group-hover/bar:bg-foreground/85 h-4 rounded-r-sm transition-colors duration-150"
                      style={{
                        minWidth: count > 0 ? 4 : 0,
                        width: `${(count / max) * 100}%`,
                      }}
                    />
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {count}
                      <span className="text-muted-foreground/70">
                        {" "}
                        · {percent.format(share)}
                      </span>
                    </span>
                  </div>
                </FluidTooltip.Trigger>
                <FluidTooltip.Content>{label}</FluidTooltip.Content>
              </FluidTooltip.Root>
            </li>
          );
        })}
      </ul>
    </FluidTooltip.Group>
  );
}

function AddedPerWeek({
  records,
  table,
}: {
  records: CrmRecord[];
  table: CrmTable;
}) {
  const first = firstWeek();
  const weeks = Array.from({ length: WEEKS }, (_, index) => {
    const start = addWeeks(first, index);
    const end = addWeeks(start, 1);
    return {
      count: records.filter((record) => {
        const created = record.createdAt * 1000;
        return created >= start.getTime() && created < end.getTime();
      }).length,
      start,
    };
  });
  const max = Math.max(1, ...weeks.map((week) => week.count));
  const noun = (count: number) =>
    (count === 1 ? table.singular : table.title).toLowerCase();
  return (
    <figure className="flex flex-col gap-2">
      <div aria-hidden className="flex h-36 items-end gap-0.5 border-b">
        <FluidTooltip.Group>
          {weeks.map(({ start, count }) => (
            <FluidTooltip.Root key={start.toISOString()}>
              <FluidTooltip.Trigger>
                <div className="group/bar flex h-full flex-1 items-end justify-center">
                  <span
                    className="bg-foreground/70 group-hover/bar:bg-foreground/85 w-full max-w-6 rounded-t-sm transition-colors duration-150"
                    style={{
                      height: `${(count / max) * 100}%`,
                      minHeight: count > 0 ? 4 : 0,
                    }}
                  />
                </div>
              </FluidTooltip.Trigger>
              <FluidTooltip.Content>
                <span className="font-medium tabular-nums">{count}</span> added
                the week of {format(start, "MMM d")}
              </FluidTooltip.Content>
            </FluidTooltip.Root>
          ))}
        </FluidTooltip.Group>
      </div>
      <div
        aria-hidden
        className="text-muted-foreground flex justify-between text-xs"
      >
        <span>{format(first, "MMM d")}</span>
        <span>This week</span>
      </div>
      <table className="sr-only">
        <caption>{table.title} added per week</caption>
        <tbody>
          {weeks.map(({ start, count }) => (
            <tr key={start.toISOString()}>
              <th scope="row">Week of {format(start, "MMMM d")}</th>
              <td>
                {count} {noun(count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Average days spent in each stage, from the moves recorded on each record. */
function TimeInStage({
  field,
  records,
}: {
  field: Field;
  records: CrmRecord[];
}) {
  const stints = new Map<string, number[]>();
  for (const record of records) {
    for (const [index, move] of record.moves.entries()) {
      const next = record.moves[index + 1];
      if (next) {
        const days = (next.at - move.at) / DAY;
        stints.set(move.stage, [...(stints.get(move.stage) ?? []), days]);
      }
    }
  }
  const rows = field.options
    .filter((option) => option.kind === "open")
    .map((option) => {
      const days = stints.get(option.id) ?? [];
      return {
        average:
          days.length > 0
            ? days.reduce((sum, item) => sum + item, 0) / days.length
            : undefined,
        moves: days.length,
        option,
      };
    });
  if (rows.every((row) => row.average === undefined)) {
    return (
      <p className="text-muted-foreground text-sm">
        Shows up once records start moving between stages.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th className="pb-2 text-left font-medium">Stage</th>
          <th className="pb-2 text-right font-medium">Average</th>
          <th className="pb-2 text-right font-medium">Moved on</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ option, average, moves }) => (
          <tr className="border-t" key={option.id}>
            <td className="py-2">
              <OptionChip dot option={option} />
            </td>
            <td className="py-2 text-right tabular-nums">
              {average === undefined
                ? "–"
                : `${average < 1 ? "<1" : Math.round(average)} d`}
            </td>
            <td className="text-muted-foreground py-2 text-right tabular-nums">
              {moves}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ByOwner({
  owner,
  stage,
  records,
}: {
  owner: Field;
  stage?: Field;
  records: CrmRecord[];
}) {
  const counts = new Map<string, { total: number; won: number }>();
  for (const record of records) {
    const person = firstValue(record, owner.id) ?? "";
    const entry = counts.get(person) ?? { total: 0, won: 0 };
    entry.total += 1;
    if (stage && stageOf(stage, record)?.kind === "won") {
      entry.won += 1;
    }
    counts.set(person, entry);
  }
  const rows = [...counts].toSorted((a, b) => b[1].total - a[1].total);
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th className="pb-2 text-left font-medium">{owner.name}</th>
          <th className="pb-2 text-right font-medium">Total</th>
          {stage && <th className="pb-2 text-right font-medium">Won</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(([person, { total, won }]) => (
          <tr className="border-t" key={person || "nobody"}>
            <td className="max-w-0 py-2">
              {person ? (
                <Person pubkey={person} />
              ) : (
                <span className="text-muted-foreground">Nobody</span>
              )}
            </td>
            <td className="py-2 text-right tabular-nums">{total}</td>
            {stage && <td className="py-2 text-right tabular-nums">{won}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Quiet({ records }: { records: CrmRecord[] }) {
  const { recordHref } = useCrm();
  if (records.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Everything moved in the last {QUIET_DAYS} days.
      </p>
    );
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {records.map((record) => (
        <li key={record.id}>
          <Link
            className="hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-9 items-center gap-3 rounded-lg px-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-3"
            href={recordHref(record)}
          >
            <span className="min-w-0 flex-1 truncate">
              {recordTitle(record)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatDistanceToNowStrict(new Date(record.updatedAt * 1000), {
                addSuffix: true,
              })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function InsightsView() {
  const { records, table } = useCrm();
  const stage = stageField(table);
  const owner = table.fields.find((field) => field.type === "member");
  const now = nowSeconds();
  const monthAgo = now - 30 * DAY;

  const kinds = stage
    ? records.map((record) => stageOf(stage, record)?.kind ?? "open")
    : [];
  const won = kinds.filter((kind) => kind === "won").length;
  const lost = kinds.filter((kind) => kind === "lost").length;
  const open = records.length - won - lost;
  const wonLabel =
    stage?.options.find((option) => option.kind === "won")?.label ?? "Won";
  const recent = records.filter(
    (record) => record.createdAt >= monthAgo
  ).length;
  const quiet = records
    .filter(
      (record, index) =>
        kinds[index] !== "won" &&
        kinds[index] !== "lost" &&
        now - record.updatedAt > QUIET_DAYS * DAY
    )
    .toSorted((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, 8);
  const daysToWin = stage
    ? records.flatMap((record) => {
        const win = record.moves.find(
          (move) => findOption(stage, move.stage)?.kind === "won"
        );
        return win
          ? [differenceInCalendarDays(win.at * 1000, record.createdAt * 1000)]
          : [];
      })
    : [];
  const averageToWin =
    daysToWin.length > 0
      ? Math.round(
          daysToWin.reduce((sum, days) => sum + days, 0) / daysToWin.length
        )
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={table.title}
          note={`${compact.format(recent)} added in 30 days`}
          value={compact.format(records.length)}
        />
        {stage ? (
          <>
            <StatTile label="In progress" value={compact.format(open)} />
            <StatTile
              label={wonLabel}
              note={
                averageToWin === undefined
                  ? undefined
                  : `${averageToWin} days on average`
              }
              value={compact.format(won)}
            />
            <StatTile
              label="Conversion"
              note={`${won} of ${won + lost} that ended`}
              value={won + lost > 0 ? percent.format(won / (won + lost)) : "–"}
            />
          </>
        ) : (
          <StatTile
            label="Quiet for 30 days"
            value={compact.format(quiet.length)}
          />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {stage && stage.options.length > 0 && (
          <Card
            description={`Where every ${table.singular.toLowerCase()} is right now.`}
            title={stage.name}
          >
            <Funnel field={stage} records={records} table={table} />
          </Card>
        )}
        <Card
          description={`New ${table.title.toLowerCase()} over the last ${WEEKS} weeks.`}
          title="Added per week"
        >
          <AddedPerWeek records={records} table={table} />
        </Card>
        {stage && (
          <Card
            description="Average time before moving on."
            title="Time in each stage"
          >
            <TimeInStage field={stage} records={records} />
          </Card>
        )}
        {owner && (
          <Card title={`By ${owner.name.toLowerCase()}`}>
            <ByOwner owner={owner} records={records} stage={stage} />
          </Card>
        )}
        <Card
          className="lg:col-span-2"
          description={`Still in progress and untouched for ${QUIET_DAYS}+ days.`}
          title="Needs attention"
        >
          <Quiet records={quiet} />
        </Card>
      </div>
    </div>
  );
}
