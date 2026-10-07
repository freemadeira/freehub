import { cn } from "cn";

import { recordReference } from "@/features/map/map-path";
import type {
  CrmRecord,
  CrmTable,
  Field,
  FieldOption,
  ProjectContent,
} from "@/lib/crm";
import { firstValue, recordStage } from "@/lib/crm";
import type { Location } from "@/lib/location";
import { readLocation } from "@/lib/location";
import { SWATCH_COLORS } from "@/lib/palette";
import type { Project } from "@/lib/project";

/** The filter value that shows every table's records. */
export const ALL_TABLES = "all";

/** A table with a location field, whose records can stand on the map. */
export interface Mapped {
  key: string;
  project: Project;
  content: ProjectContent;
  table: CrmTable;
  field: Field;
}

/** A record with a place on the map. */
export interface Pin extends Mapped {
  record: CrmRecord;
  location: Location;
  stage?: FieldOption;
}

export function mappedTables(
  projects: Project[],
  contents: Map<string, ProjectContent>
): Mapped[] {
  return projects.flatMap((project) => {
    const content = contents.get(project.address);
    return (content?.tables ?? []).flatMap((table) => {
      const field = table.fields.find((item) => item.type === "location");
      return content && field
        ? [
            {
              content,
              field,
              key: `${project.slug}/${table.slug}`,
              project,
              table,
            },
          ]
        : [];
    });
  });
}

function pinsOf(tables: Mapped[]): Pin[] {
  return tables.flatMap((mapped) =>
    (mapped.content.byTable.get(mapped.table.id) ?? []).flatMap((record) => {
      const location = readLocation(firstValue(record, mapped.field.id));
      return location
        ? [
            {
              ...mapped,
              location,
              record,
              stage: recordStage(mapped.table, record),
            },
          ]
        : [];
    })
  );
}

/**
 * The records on the map for a filter, and the tables worth filtering by:
 * those with something on it. A filter on a table that has nothing left
 * falls back to all of them.
 */
export function pinsFor(
  tables: Mapped[],
  filter: string
): { located: Pin[]; listed: Mapped[]; shown: string; pins: Pin[] } {
  const located = pinsOf(tables);
  const listed = tables.filter((table) =>
    located.some((pin) => pin.key === table.key)
  );
  const shown = listed.some((table) => table.key === filter)
    ? filter
    : ALL_TABLES;
  return {
    listed,
    located,
    pins:
      shown === ALL_TABLES
        ? located
        : located.filter((pin) => pin.key === shown),
    shown,
  };
}

export function pinReference(pin: Pin): string {
  return recordReference(pin.project, pin.table, pin.record);
}

/** The record's stage color, or the theme's when it has none. */
export function pinColors(pin: Pin): string {
  return pin.stage
    ? cn(SWATCH_COLORS[pin.stage.color], "text-white")
    : "bg-primary text-primary-foreground";
}
