import type {
  Connection,
  CrmRecordFields,
  CrmTableFields,
  StageMove,
} from "@/lib/crm";
import { stageField } from "@/lib/crm";
import type { SourceFields } from "@/lib/sources";
import { canFill, hasValues } from "@/lib/sources";

import type { Item } from "./sources/types";

/** An item as the table holds it: field id to values, and the title apart. */
export interface Mapped {
  title?: string;
  values: Record<string, string[]>;
}

/**
 * The item's values in the table's fields, through the connection. Values
 * without a mapped option and fields that no longer fit are left out, so the
 * record keeps what it has there.
 */
export function mapItem(
  table: Pick<CrmTableFields, "fields">,
  connection: Connection,
  source: SourceFields,
  item: Item
): Mapped {
  const mapped: Mapped = { values: {} };
  for (const attribute of source.attributes) {
    const field = table.fields.find(
      ({ id }) => id === connection.fields[attribute.id]
    );
    if (!(field && canFill(attribute, field))) {
      continue;
    }
    const raw = item.values[attribute.id] ?? [];
    if (field.type === "title") {
      mapped.title = raw[0] ?? "";
      continue;
    }
    let values = raw;
    if (hasValues(attribute, field)) {
      const options = connection.options[attribute.id] ?? {};
      values = raw.flatMap((value) => {
        const option = options[value];
        return option && field.options.some(({ id }) => id === option)
          ? [option]
          : [];
      });
      if (values.length < raw.length) {
        continue;
      }
    }
    mapped.values[field.id] =
      field.type === "multiselect" ? values : values.slice(0, 1);
  }
  return mapped;
}

function same(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function withoutEmpty(
  values: Record<string, string[]>
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(values).filter(([, list]) => list.length > 0)
  );
}

export interface MergeInput {
  table: Pick<CrmTableFields, "fields">;
  id: string;
  mapped: Mapped;
  item: Item;
  /** The record's latest version, by a member or the connector. */
  current?: CrmRecordFields;
  /** The connector's own latest version: what the source said last time. */
  base?: CrmRecordFields;
  me: string;
  /** Unix seconds. */
  now: number;
}

/**
 * The record with what the source changed since it last wrote. A value the
 * source didn't change keeps whatever a teammate made of it.
 */
export function mergeRecord({
  table,
  id,
  mapped,
  item,
  current,
  base,
  me,
  now,
}: MergeInput): CrmRecordFields {
  const record: CrmRecordFields = current
    ? { ...current, values: { ...current.values } }
    : {
        createdAt: item.createdAt,
        creator: me,
        id,
        moves: [],
        rank: 0,
        title: "",
        values: {},
      };
  if (
    mapped.title !== undefined &&
    !(current && base && base.title === mapped.title)
  ) {
    record.title = mapped.title;
  }
  for (const [field, values] of Object.entries(mapped.values)) {
    if (!(current && base && same(base.values[field], values))) {
      record.values[field] = values;
    }
  }
  record.values = withoutEmpty(record.values);

  const stage = stageField(table);
  const next = stage ? record.values[stage.id]?.[0] : undefined;
  if (stage && next && next !== current?.values[stage.id]?.[0]) {
    const move: StageMove = {
      at: Math.min(now, item.updatedAt),
      by: me,
      stage: next,
    };
    record.moves = [...record.moves, move];
  }
  return record;
}
